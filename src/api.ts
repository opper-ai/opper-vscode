/**
 * Thin client for the two Opper endpoints this extension needs:
 * `GET /v3/compat/models` for discovery and `POST /v3/compat/chat/completions`
 * for the turn itself. Both are OpenAI-shaped.
 */

import { DONE, SSEDecoder, parseChunk } from './sse';

/** The `opper` block on a `/v3/compat/models` entry. */
export interface OpperMeta {
	/** What this entry IS — the three things a caller may put in `model`. */
	kind: 'model' | 'pool' | 'dynamic_route';
	/**
	 * Catalog modality: "llm" or "embedding". The listing carries both, and
	 * this is the only reliable way to tell them apart — a large share of the
	 * catalogue's embedding rows claim a `tools` capability.
	 * Absent on dynamic_route entries.
	 */
	type?: 'llm' | 'embedding' | string;
	/** Catalog rows a pool routes over. Pools only. */
	members?: string[];
	/** Deployed version a call would execute. Routes only. */
	version?: number;
	/** The route's human description. Routes only. */
	description?: string;
	/** `text`, `tools`, `vision`, `pdf`, `structured_output`, `reasoning`, … */
	capabilities?: string[];
	max_output_tokens?: number;
	region?: string;
	country?: string;
	/** `always` (ZDR by default) or `enterprise` (available under terms). */
	zdr?: string;
	gdpr_residency?: string;
	verification?: string;
}

export interface OpperCompatModel {
	id: string;
	object: string;
	created: number;
	owned_by: string;
	context_length?: number;
	pricing?: {
		prompt?: string;
		completion?: string;
		[key: string]: string | undefined;
	};
	opper?: OpperMeta;
}

export interface BudgetScope {
	currency?: string;
	spent_cents?: number;
	limit_cents?: number | null;
	remaining_cents?: number | null;
	limit_scope?: 'project' | 'organization' | null;
	period_start?: string;
	period_end?: string;
}

/** Identity and spend snapshot for the calling key, from `GET /v3/me`. */
export interface OpperIdentity {
	organization?: { name?: string; plan?: string };
	project?: { name?: string };
	visibility?: { organization_finance?: boolean };
	project_spend?: BudgetScope;
	spend?: BudgetScope;
	balance?: { currency?: string; balance_cents?: number; balance_dollars?: number };
	blocked?: boolean;
	block_reason?: 'balance_exhausted' | 'project_spend_cap_hit' | 'org_spend_cap_hit' | string;
}

export interface OpenAIToolCallDelta {
	index: number;
	id?: string;
	type?: string;
	function?: { name?: string; arguments?: string };
}

export interface ChatCompletionChunk {
	choices?: {
		index?: number;
		delta?: {
			content?: string | null;
			tool_calls?: OpenAIToolCallDelta[];
		};
		finish_reason?: string | null;
	}[];
	usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
	error?: { message?: string; type?: string; code?: string };
}

/** A request the gateway rejected, carrying enough detail to be actionable. */
export class OpperApiError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly body?: string,
		readonly code?: string,
	) {
		super(message);
		this.name = 'OpperApiError';
	}
}

export class OpperClient {
	constructor(
		private readonly baseUrl: string,
		private readonly apiKey: string,
	) {}

	private url(path: string): string {
		return `${this.baseUrl.replace(/\/+$/, '')}${path}`;
	}

	private headers(): Record<string, string> {
		return {
			Authorization: `Bearer ${this.apiKey}`,
			'Content-Type': 'application/json',
			'User-Agent': 'opper-vscode',
		};
	}

	/**
	 * Lists everything the key may put in `model` — concrete catalog rows, the
	 * pools that load-balance a bare name across providers, and the org's own
	 * deployed dynamic routes. Comply-scoped server-side, so a model this org
	 * is not allowed to reach never comes back in the first place.
	 */
	async listModels(kinds?: string, signal?: AbortSignal): Promise<OpperCompatModel[]> {
		const path = kinds ? `/v3/compat/models?type=${encodeURIComponent(kinds)}` : '/v3/compat/models';
		const res = await fetch(this.url(path), {
			method: 'GET',
			headers: this.headers(),
			redirect: 'error',
			signal,
		});
		if (!res.ok) {
			throw await toApiError(res, 'listing models');
		}
		const body = (await res.json()) as { data?: OpperCompatModel[] };
		return body.data ?? [];
	}

	/**
	 * Reads the identity the key resolves to. Comply rules are scoped to the
	 * key's PROJECT, so which project a key belongs to decides which allowlist
	 * applies — and that is invisible from the model list alone.
	 */
	async getMe(signal?: AbortSignal): Promise<OpperIdentity> {
		const res = await fetch(this.url('/v3/me'), {
			method: 'GET',
			headers: this.headers(),
			redirect: 'error',
			signal,
		});
		if (!res.ok) {
			throw await toApiError(res, 'reading the key identity');
		}
		return (await res.json()) as OpperIdentity;
	}

	/**
	 * Streams one chat completion, yielding raw OpenAI chunks. Translation into
	 * VS Code response parts is the provider's job, not the client's.
	 */
	async *streamChat(
		body: Record<string, unknown>,
		signal?: AbortSignal,
	): AsyncGenerator<ChatCompletionChunk> {
		const res = await fetch(this.url('/v3/compat/chat/completions'), {
			method: 'POST',
			headers: this.headers(),
			redirect: 'error',
			body: JSON.stringify({ ...body, stream: true, stream_options: { include_usage: true } }),
			signal,
		});
		if (!res.ok) {
			throw await toApiError(res, 'starting the completion');
		}
		if (!res.body) {
			throw new OpperApiError('the gateway returned no response body', res.status);
		}

		const decoder = new SSEDecoder();
		const reader = res.body.getReader();
		try {
			for (;;) {
				const { done, value } = await reader.read();
				const frames = done ? decoder.flush() : decoder.push(value!);
				for (const frame of frames) {
					if (frame === DONE) {
						return;
					}
					const chunk = parseChunk<ChatCompletionChunk>(frame);
					if (!chunk) {
						continue;
					}
					// An error can arrive mid-stream, after a 200: the gateway
					// has already committed to the status line by the time an
					// upstream provider fails.
					if (chunk.error) {
						throw new OpperApiError(
							chunk.error.message ?? 'the model returned an error mid-stream',
							res.status,
							JSON.stringify({ error: chunk.error }),
							chunk.error.code,
						);
					}
					yield chunk;
				}
				if (done) {
					return;
				}
			}
		} finally {
			// Cancelling the turn must not leave the socket draining.
			await reader.cancel().catch(() => undefined);
		}
	}
}

/**
 * Turns a failed response into an error whose message is worth showing. Opper
 * returns `{"error": {"message": ...}}`; some upstream errors surface as a bare
 * `{"error": "..."}` or as plain text, so all three shapes are unwrapped before
 * falling back to the status line.
 */
async function toApiError(res: Response, doing: string): Promise<OpperApiError> {
	const raw = await res.text().catch(() => '');
	let detail = '';
	try {
		const parsed = JSON.parse(raw) as { error?: { message?: string } | string; detail?: string };
		if (typeof parsed.error === 'string') {
			detail = parsed.error;
		} else if (parsed.error?.message) {
			detail = parsed.error.message;
		} else if (parsed.detail) {
			detail = parsed.detail;
		}
	} catch {
		detail = raw.slice(0, 500);
	}
	const hint =
		res.status === 401
			? ' — check your Opper API key (run "Opper: Sign In")'
			: res.status === 403
				? ' — this key may not be entitled to that model, or your comply policy denies it'
				: '';
	return new OpperApiError(
		`Opper failed ${doing}: ${res.status}${detail ? ` ${detail}` : ''}${hint}`,
		res.status,
		raw,
		res.headers.get('X-Opper-Error-Code') ?? undefined,
	);
}
