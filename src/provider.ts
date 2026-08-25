import * as vscode from 'vscode';

import { OpperApiError, OpperClient, type OpenAIToolCallDelta } from './api';
import { DEFAULT_FILTER, toChatInformation, type CatalogFilter } from './catalog';
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

	constructor(private readonly auth: Auth) {}

	/** Re-fetches the catalogue in the picker — after a key change, say. */
	refresh(): void {
		this.changed.fire();
	}

	dispose(): void {
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
		const key = options.silent
			? await this.auth.peekApiKey()
			: await this.auth.requireApiKey();
		if (!key) {
			return [];
		}

		const client = new OpperClient(baseUrl(), key);
		try {
			const entries = await client.listModels(abortSignal(token));
			return toChatInformation(entries, readFilter());
		} catch (err) {
			// Never throw out of discovery: a failure here blanks the whole
			// picker, including other vendors' models.
			if (!options.silent) {
				void vscode.window.showErrorMessage(describe(err));
			}
			console.error('[opper] listing models failed', err);
			return [];
		}
	}

	async provideLanguageModelChatResponse(
		model: vscode.LanguageModelChatInformation,
		messages: readonly vscode.LanguageModelChatRequestMessage[],
		options: vscode.ProvideLanguageModelChatResponseOptions,
		progress: vscode.Progress<vscode.LanguageModelResponsePart>,
		token: vscode.CancellationToken,
	): Promise<void> {
		const key = await this.auth.peekApiKey();
		if (!key) {
			throw new Error('No Opper API key configured. Run "Opper: Manage API Key".');
		}

		const body: Record<string, unknown> = {
			model: model.id,
			messages: toOpenAIMessages(messages),
			...(options.modelOptions ?? {}),
		};

		const tools = toOpenAITools(options.tools);
		if (tools) {
			body.tools = tools;
			body.tool_choice =
				options.toolMode === vscode.LanguageModelChatToolMode.Required ? 'required' : 'auto';
		}

		const client = new OpperClient(baseUrl(), key);
		const pending = new ToolCallAccumulator();

		try {
			for await (const chunk of client.streamChat(body, abortSignal(token))) {
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
			throw new Error(describe(err));
		}
	}

	async provideTokenCount(
		_model: vscode.LanguageModelChatInformation,
		text: string | vscode.LanguageModelChatRequestMessage,
	): Promise<number> {
		// VS Code calls this constantly to budget context, so it must be local:
		// a network round-trip per estimate would make the chat input lag.
		// Opper spans 300+ models across a dozen tokenizers and no single exact
		// count exists, so this is the same chars/4 heuristic the gateway's own
		// countTokens endpoint falls back to — good to roughly ±20% on prose,
		// which is what a "does this fit?" check needs.
		return Math.ceil(flatten(text).length / 4);
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
			out += part.content.map((c) => (c instanceof vscode.LanguageModelTextPart ? c.value : '')).join('');
		}
	}
	return out;
}

/** Bridges a VS Code cancellation token onto fetch's AbortSignal. */
function abortSignal(token: vscode.CancellationToken): AbortSignal {
	const controller = new AbortController();
	if (token.isCancellationRequested) {
		controller.abort();
	} else {
		token.onCancellationRequested(() => controller.abort());
	}
	return controller.signal;
}

function baseUrl(): string {
	return (
		vscode.workspace.getConfiguration('opper').get<string>('baseUrl') ?? 'https://api.opper.ai'
	);
}

function readFilter(): CatalogFilter {
	const cfg = vscode.workspace.getConfiguration('opper');
	return {
		showPools: cfg.get('showPools', DEFAULT_FILTER.showPools),
		showDynamicRoutes: cfg.get('showDynamicRoutes', DEFAULT_FILTER.showDynamicRoutes),
		dynamicRouteToolCalling: cfg.get(
			'dynamicRouteToolCalling',
			DEFAULT_FILTER.dynamicRouteToolCalling,
		),
		euOnly: cfg.get('euOnly', DEFAULT_FILTER.euOnly),
		zdrOnly: cfg.get('zdrOnly', DEFAULT_FILTER.zdrOnly),
		modelFilter: cfg.get('modelFilter', DEFAULT_FILTER.modelFilter),
	};
}

function describe(err: unknown): string {
	if (err instanceof OpperApiError) {
		return err.message;
	}
	if (err instanceof Error) {
		return `Opper request failed: ${err.message}`;
	}
	return `Opper request failed: ${String(err)}`;
}
