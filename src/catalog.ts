import { contextLimits } from './context';
/**
 * Turns `/v3/compat/models` entries into the model metadata VS Code needs
 * before a model is selectable.
 *
 * `import type` only — nothing here touches the `vscode` runtime, so the
 * mapping rules can be unit-tested under plain `node --test`.
 */

import type * as vscode from 'vscode';
import type { OpperCompatModel, ZdrFacts } from './api';

export interface CatalogFilter {
	showModels: boolean;
	showPools: boolean;
	showDynamicRoutes: boolean;
}

export const DEFAULT_FILTER: CatalogFilter = {
	showModels: true,
	showPools: true,
	showDynamicRoutes: true,
};

/**
 * The `?type=` value for a filter, or undefined when every kind is wanted.
 *
 * Returns null when NOTHING is selected. That case cannot be expressed as a
 * query parameter: `?type=` with an empty value means "every kind" to the
 * gateway (an absent filter matches all), so sending it would return the whole
 * catalogue — the exact opposite of what was asked. The caller must skip the
 * request instead.
 */
export function kindQuery(filter: CatalogFilter): string | undefined | null {
	const kinds: string[] = [];
	if (filter.showModels) {
		kinds.push('model');
	}
	if (filter.showPools) {
		kinds.push('pool');
	}
	if (filter.showDynamicRoutes) {
		kinds.push('dynamic_route');
	}
	if (kinds.length === 0) {
		return null;
	}
	return kinds.length === 3 ? undefined : kinds.join(',');
}

/** Sort rank: Opper's own routing constructs first, concrete rows after. */
function kindRank(kind: string): number {
	return kind === 'dynamic_route' ? 0 : kind === 'pool' ? 1 : 2;
}

export function toChatInformation(
	entries: OpperCompatModel[],
	filter: CatalogFilter,
): vscode.LanguageModelChatInformation[] {
	const out: { info: vscode.LanguageModelChatInformation; rank: number }[] = [];
	for (const entry of entries) {
		const info = mapEntry(entry, filter);
		if (info) {
			out.push({ info, rank: kindRank(entry.opper?.kind ?? 'model') });
		}
	}
	// Routes, then pools, then concrete models. The gateway returns the reverse,
	// which buries an org's handful of routes and pools under several hundred
	// catalog rows — the entries most specific to this org end up hardest to
	// find. Stable within a rank, so the gateway's featured-first ordering
	// survives among the concrete models.
	return out
		.map((e, i) => ({ ...e, i }))
		.sort((a, b) => a.rank - b.rank || a.i - b.i)
		.map((e) => e.info);
}

function mapEntry(
	entry: OpperCompatModel,
	filter: CatalogFilter,
): vscode.LanguageModelChatInformation | undefined {
	const meta = entry.opper;
	const kind = meta?.kind ?? 'model';

	if (kind === 'model' && !filter.showModels) {
		return undefined;
	}
	if (kind === 'pool' && !filter.showPools) {
		return undefined;
	}
	if (kind === 'dynamic_route' && !filter.showDynamicRoutes) {
		return undefined;
	}
	// Embeddings share this listing with chat models. `opper.type` is the only
	// reliable discriminator — a good share of the catalogue's embedding rows
	// claim a `tools` capability, so filtering on capabilities would offer
	// text-embedding-3-large as a tool-calling chat model.
	if (meta?.type && meta.type !== 'llm') {
		return undefined;
	}

	const capabilities = meta?.capabilities ?? [];
	const isRoute = kind === 'dynamic_route';

	const limits = contextLimits(entry.context_length, meta?.max_output_tokens);
	// Without trustworthy limits, including routes, do not advertise invented capacity.
	if (!limits) return undefined;

	return {
		id: entry.id,
		// The id IS the name users type and the thing that disambiguates
		// `anthropic/claude-sonnet-4.5` (pinned provider) from the pool
		// `claude-sonnet-4.5` (load-balanced). Prettifying would collapse them.
		name: entry.id,
		family: familyOf(entry, kind),
		version: meta?.version !== undefined ? String(meta.version) : '1',
		// context_length bounds the whole exchange, so the reply has to come
		// out of it. Handing VS Code the full window as input budget lets it
		// fill the context and leave the completion no room.
		maxInputTokens: limits.input,
		maxOutputTokens: limits.output,
		capabilities: {
			toolCalling: capabilities.includes('tools'),
			imageInput: isRoute ? false : capabilities.includes('vision'),
		},
		detail: detailOf(entry, kind),
		tooltip: tooltipOf(entry, kind),
	};
}

function familyOf(entry: OpperCompatModel, kind: string): string {
	if (kind === 'pool') {
		return 'opper-pool';
	}
	if (kind === 'dynamic_route') {
		return 'opper-route';
	}
	return entry.owned_by || 'opper';
}

/**
 * Whether an entry is zero-data-retention by default.
 *
 * Derived from the `opper.zdr` facts, never declared: operational logging must
 * be known not to retain content (`logging === false`) and no moderation layer
 * may be known to hold it (`moderation !== true`). This is the same rule
 * opper.ai applies. Anything short of that — a `null` where a `false` is
 * needed, a missing or malformed field — is NOT by default; ZDR is never
 * inferred from silence.
 */
export function zdrByDefault(zdr: unknown): boolean {
	// The bare string is the retired wire format; `always` meant exactly this.
	if (zdr === 'always') {
		return true;
	}
	return isZdrFacts(zdr) && zdr.logging === false && zdr.moderation !== true;
}

function isZdrFacts(zdr: unknown): zdr is ZdrFacts {
	return typeof zdr === 'object' && zdr !== null && !Array.isArray(zdr);
}

/** The tooltip line for `opper.zdr`, or undefined when there is nothing to say. */
function zdrTooltip(zdr: unknown): string | undefined {
	if (zdrByDefault(zdr)) {
		return 'Zero data retention: on by default.';
	}
	if (typeof zdr === 'string') {
		// Retired wire format: `enterprise` = available under terms, not on.
		return zdr ? `Zero data retention: ${zdr}.` : undefined;
	}
	if (!isZdrFacts(zdr)) {
		return undefined;
	}
	const why: string[] = [];
	if (zdr.logging === true) {
		why.push('logging retains content');
	} else if (zdr.logging !== false) {
		why.push('logging retention not established');
	}
	if (zdr.moderation === true) {
		why.push('moderation holds content');
	}
	return `Not zero data retention by default: ${why.join(', ')}.`;
}

/** The one line under the model name in the picker. Residency leads. */
function detailOf(entry: OpperCompatModel, kind: string): string {
	const meta = entry.opper;
	const bits: string[] = [];

	if (kind === 'pool') {
		bits.push(`Pool of ${meta?.members?.length ?? 0}`);
	} else if (kind === 'dynamic_route') {
		bits.push(meta?.version !== undefined ? `Route v${meta.version}` : 'Route');
	} else {
		bits.push(entry.owned_by);
	}

	const where = meta?.country || meta?.region;
	if (where) {
		bits.push(where);
	}
	if (zdrByDefault(meta?.zdr)) {
		bits.push('ZDR');
	}
	return bits.join(' · ');
}

function tooltipOf(entry: OpperCompatModel, kind: string): string {
	const meta = entry.opper;
	const lines: string[] = [];

	if (kind === 'pool') {
		lines.push(`Opper pool — load-balances across ${meta?.members?.length ?? 0} providers.`);
		if (meta?.members?.length) {
			lines.push(meta.members.join(', '));
		}
		lines.push('Capabilities and residency shown hold for every member.');
	} else if (kind === 'dynamic_route') {
		lines.push('Opper dynamic route — the routing graph picks the model per request.');
		if (meta?.description) {
			lines.push(meta.description);
		}
	} else {
		lines.push(`${entry.id} via ${entry.owned_by}.`);
	}

	if (meta?.gdpr_residency) {
		lines.push(`GDPR residency: ${meta.gdpr_residency}`);
	}
	const zdr = zdrTooltip(meta?.zdr);
	if (zdr) {
		lines.push(zdr);
	}
	if (meta?.verification) {
		lines.push(`Verification: ${meta.verification.replace(/_/g, ' ')}.`);
	}

	const price = priceLine(entry);
	if (price) {
		lines.push(price);
	}
	if (entry.context_length) lines.push(`Context window: ${entry.context_length.toLocaleString()} tokens. Input estimates vary by model.`);
	return lines.join('\n');
}

/** Per-token USD strings are unreadable; per-million is what people quote. */
function priceLine(entry: OpperCompatModel): string | undefined {
	const prompt = Number(entry.pricing?.prompt);
	const completion = Number(entry.pricing?.completion);
	if (!Number.isFinite(prompt) || !Number.isFinite(completion)) {
		return undefined;
	}
	if (prompt === 0 && completion === 0) {
		return undefined;
	}
	const fmt = (n: number) => `$${(n * 1e6).toFixed(2)}`;
	return `${fmt(prompt)} in / ${fmt(completion)} out per 1M tokens`;
}
