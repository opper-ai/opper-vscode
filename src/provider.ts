import { ModelCatalog } from './model-catalog';
import { contextSummary, estimateTokens, promptEstimate } from './context';
import { credentialError } from './login-errors';
import * as vscode from 'vscode';

import { OpperApiError, OpperClient, type OpenAIToolCallDelta } from './api';
import { DEFAULT_FILTER, kindQuery, toChatInformation, type CatalogFilter } from './catalog';
import { toOpenAIMessages, toOpenAITools } from './messages';
import type { Auth } from './auth';

/**
 * Contributes Opper's catalogue to the VS Code chat model picker.
 *
 * One provider, many models: concrete catalog rows, the pools that
 * load-balance a bare name across providers, and the org's own deployed
 * dynamic routes — all discovered at runtime, none hardcoded.
 */
export class OpperChatModelProvider implements vscode.LanguageModelChatProvider {
	private readonly changed = new vscode.EventEmitter<void>();
	readonly onDidChangeLanguageModelChatInformation = this.changed.event;

	private readonly catalog = new ModelCatalog();
	private readonly contextItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
	private budgetDetail?: string;
	onUsage?: () => void;
	private contextDetail = 'Send a message using an Opper model to see the last request’s context estimate.';
	constructor(private readonly auth: Auth) {
		this.contextItem.command = 'opper.budget';
		this.contextItem.name = 'Opper usage and budget';
		this.contextItem.text = '$(info) Opper';
		this.contextItem.show();
	}
	resetContext(): void { this.contextItem.text = '$(info) Opper'; this.contextDetail = 'Send a message using an Opper model to see the last request’s context estimate.'; this.updateTooltip(); }
	setBudget(summary?: string): void { this.budgetDetail=summary; this.updateTooltip(); }
	private updateTooltip(): void { this.contextItem.tooltip=[this.budgetDetail ?? 'Click to view your project allowance.',this.contextDetail].join('\n\n'); }
	showContext(): void { void vscode.window.showInformationMessage(this.contextDetail); }
	private reportContext(model: vscode.LanguageModelChatInformation, used: number, actual: boolean, hasMedia: boolean): void {
		this.contextDetail = contextSummary(model.id, used, model.maxInputTokens, actual, hasMedia);
		const pct = Math.round(100 * used / model.maxInputTokens);
		this.contextItem.text = hasMedia && !actual ? '$(info) Opper: context estimate' : `$(info) Opper: ${actual ? '' : '~'}${pct}% input`;
		this.updateTooltip();
		this.onUsage?.();
		this.contextItem.show();
	}
	private models(client: OpperClient, key: string, signal: AbortSignal): Promise<import('./api').OpperCompatModel[]> {
		return this.catalog.get(`${baseUrl()}\0${key}`, () => client.listModels(undefined, signal));
	}

	/** Re-fetches the catalogue in the picker — after a key change, say. */
	refresh(): void {
		this.catalog.clear();
		this.changed.fire();
	}

	dispose(): void {
		this.contextItem.dispose();
		this.changed.dispose();
	}

	async provideLanguageModelChatInformation(
		options: { silent: boolean },
		token: vscode.CancellationToken,
	): Promise<vscode.LanguageModelChatInformation[]> {
		// `silent` means "do not interrupt the user": VS Code calls this
		// speculatively, e.g. to populate the picker before anyone has asked
		// for an Opper model. Prompting for a key here would be a modal out of
		// nowhere, so an unconfigured provider simply contributes nothing.
		const connection = cancellation(token);
		try {
			const key = options.silent
				? await this.auth.peekApiKey()
				: await this.auth.requireApiKey();
			if (!key) {
				return [];
			}

			const client = new OpperClient(baseUrl(), key);
			const filter = readFilter();
			const kinds = kindQuery(filter);
			if (kinds === null) {
				// Every kind unticked. Skip the request rather than send an
				// empty ?type=, which the gateway reads as "all kinds".
				return [];
			}
			// The one and only source of which models exist. Authenticated and
			// comply-scoped server-side, so a model the org's allowlist denies
			// is never returned and cannot be reintroduced from anywhere else.
			const entries = await this.models(client, key, connection.signal);
			return toChatInformation(entries, filter);
		} catch (err) {
			// Never throw out of discovery: a failure here blanks the whole
			// picker, including other vendors' models.
			if (!options.silent) {
				void this.auth.handleFailure(err);
			}
			// Avoid logging server response bodies or credentials.
			return [];
		} finally { connection.dispose(); }
	}

	async provideLanguageModelChatResponse(
		model: vscode.LanguageModelChatInformation,
		messages: readonly vscode.LanguageModelChatRequestMessage[],
		options: vscode.ProvideLanguageModelChatResponseOptions,
		progress: vscode.Progress<vscode.LanguageModelResponsePart>,
		token: vscode.CancellationToken,
	): Promise<void> {
		const connection = cancellation(token);
		try {
		const key = await this.auth.peekApiKey();
		if (!key) throw new Error('No Opper credential. Run "Opper: Sign In".');
		const client = new OpperClient(baseUrl(), key);
		const allowed = toChatInformation(await this.models(client, key, connection.signal), readFilter());
		const current = allowed.find(entry => entry.id === model.id);
		if (!current) { this.refresh(); throw new Error('This model is no longer available for this key. Select another Opper model.'); }
		const body: Record<string, unknown> = {
			...(options.modelOptions ?? {}),
			model: current.id,
			messages: toOpenAIMessages(messages),
			max_tokens: current.maxOutputTokens,
		};
		delete body.max_completion_tokens; // Use one output limit controlled by catalog metadata.
		const tools = toOpenAITools(options.tools);
		if (tools) {
			body.tools = tools;
			body.tool_choice = options.toolMode === vscode.LanguageModelChatToolMode.Required ? 'required' : 'auto';
		}
		const estimated = promptEstimate(body);
		this.reportContext(current, estimated.tokens, false, estimated.hasMedia);

		const pending = new ToolCallAccumulator();

			for await (const chunk of client.streamChat(body, connection.signal)) {
				if (Number.isSafeInteger(chunk.usage?.prompt_tokens) && chunk.usage!.prompt_tokens! >= 0) {
					this.reportContext(current, chunk.usage!.prompt_tokens!, true, false);
				}
				const choice = chunk.choices?.[0];
				if (!choice) {
					continue;
				}
				const text = choice.delta?.content;
				if (text) {
					progress.report(new vscode.LanguageModelTextPart(text));
				}
				if (choice.delta?.tool_calls) {
					pending.absorb(choice.delta.tool_calls);
				}
				// Tool calls stream as fragments of a JSON string; they are only
				// parseable once the model says it is done calling.
				if (choice.finish_reason) {
					pending.flush(progress);
				}
			}
			// A stream that ends without a finish_reason still owes us whatever
			// it accumulated.
			pending.flush(progress);
		} catch (err) {
			if (token.isCancellationRequested) {
				return;
			}
			if (err instanceof OpperApiError && [401, 403, 404].includes(err.status)) this.refresh();
			void this.auth.handleFailure(err);
			throw new Error(describe(err));
		} finally { connection.dispose(); }
	}

	async provideTokenCount(
		_model: vscode.LanguageModelChatInformation,
		text: string | vscode.LanguageModelChatRequestMessage,
	): Promise<number> {
		// Local approximation; not a tokenizer or a guaranteed upper bound.
		return estimateTokens(flatten(text));
	}
}

/** Reassembles OpenAI's index-keyed tool-call deltas into whole calls. */
class ToolCallAccumulator {
	private readonly byIndex = new Map<number, { id: string; name: string; args: string }>();

	absorb(deltas: OpenAIToolCallDelta[]): void {
		for (const delta of deltas) {
			const slot = this.byIndex.get(delta.index) ?? { id: '', name: '', args: '' };
			if (delta.id) {
				slot.id = delta.id;
			}
			if (delta.function?.name) {
				slot.name = delta.function.name;
			}
			if (delta.function?.arguments) {
				slot.args += delta.function.arguments;
			}
			this.byIndex.set(delta.index, slot);
		}
	}

	flush(progress: vscode.Progress<vscode.LanguageModelResponsePart>): void {
		for (const [index, slot] of this.byIndex) {
			if (!slot.name) {
				continue;
			}
			let input: object;
			try {
				input = slot.args ? (JSON.parse(slot.args) as object) : {};
			} catch {
				// Truncated or malformed arguments: surface it as text rather
				// than emitting a tool call the agent loop would run with the
				// wrong input, or dropping it so the turn just stalls.
				progress.report(
					new vscode.LanguageModelTextPart(
						`\n[opper: tool call "${slot.name}" arrived with unparseable arguments and was not run]\n`,
					),
				);
				this.byIndex.delete(index);
				continue;
			}
			progress.report(
				new vscode.LanguageModelToolCallPart(slot.id || `call_${index}`, slot.name, input),
			);
			this.byIndex.delete(index);
		}
	}
}

function flatten(text: string | vscode.LanguageModelChatRequestMessage): string {
	if (typeof text === 'string') {
		return text;
	}
	let out = '';
	for (const part of text.content) {
		if (part instanceof vscode.LanguageModelTextPart) {
			out += part.value;
		} else if (part instanceof vscode.LanguageModelToolCallPart) {
			out += part.name + JSON.stringify(part.input ?? {});
		} else if (part instanceof vscode.LanguageModelToolResultPart) {
			out += JSON.stringify(part.content);
		} else if (part instanceof vscode.LanguageModelDataPart) {
			// Unknown media costs remain estimates; never count image bytes as text tokens.
			out += ' '.repeat(12000);
		}
	}
	return out;
}

/** Bridges a VS Code cancellation token onto fetch's AbortSignal. */
function cancellation(token: vscode.CancellationToken): { signal: AbortSignal; dispose(): void } {
	const controller = new AbortController();
	const listener = token.onCancellationRequested(() => controller.abort());
	if (token.isCancellationRequested) controller.abort();
	return { signal: controller.signal, dispose: () => listener.dispose() };
}

export function baseUrl(): string {
	return (
		vscode.workspace.getConfiguration('opper').get<string>('baseUrl') ?? 'https://api.opper.ai'
	);
}

export function readFilter(): CatalogFilter {
	const cfg = vscode.workspace.getConfiguration('opper');
	return {
		showModels: cfg.get('showModels', DEFAULT_FILTER.showModels),
		showPools: cfg.get('showPools', DEFAULT_FILTER.showPools),
		showDynamicRoutes: cfg.get('showDynamicRoutes', DEFAULT_FILTER.showDynamicRoutes),
		dynamicRouteToolCalling: cfg.get(
			'dynamicRouteToolCalling',
			DEFAULT_FILTER.dynamicRouteToolCalling,
		),
		modelFilter: cfg.get('modelFilter', DEFAULT_FILTER.modelFilter),
	};
}

function describe(err: unknown): string {
	if (err instanceof OpperApiError) {
		return credentialError(err.status, err.body, err.code) ?? err.message;
	}
	if (err instanceof Error) {
		return `Opper request failed: ${err.message}`;
	}
	return `Opper request failed: ${String(err)}`;
}
