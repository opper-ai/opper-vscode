/**
 * Turns `/v3/compat/models` entries into the model metadata VS Code needs
 * before a model is selectable.
 *
 * `import type` only — nothing here touches the `vscode` runtime, so the
 * mapping rules can be unit-tested under plain `node --test`.
 */

import type * as vscode from 'vscode';
import type { OpperCompatModel } from './api';

export interface CatalogFilter {
	showPools: boolean;
	showDynamicRoutes: boolean;
	dynamicRouteToolCalling: boolean;
	euOnly: boolean;
	zdrOnly: boolean;
	modelFilter: string[];
}

export const DEFAULT_FILTER: CatalogFilter = {
	showPools: true,
	showDynamicRoutes: true,
	dynamicRouteToolCalling: true,
	euOnly: false,
	zdrOnly: false,
	modelFilter: [],
};

/**
 * What a dynamic route gets when Opper cannot say. The graph picks the model
 * per request, so these are the only honest option: floors low enough that
 * VS Code's history trimming stays inside whatever model answers.
 */
const ROUTE_CONTEXT = 128_000;
const ROUTE_MAX_OUTPUT = 8_192;

/** Reserved for the reply when a model does not report its own output cap. */
const FALLBACK_OUTPUT_RESERVE = 4_096;

export function toChatInformation(
	entries: OpperCompatModel[],
	filter: CatalogFilter,
): vscode.LanguageModelChatInformation[] {
	const out: vscode.LanguageModelChatInformation[] = [];
	for (const entry of entries) {
		const info = mapEntry(entry, filter);
		if (info) {
			out.push(info);
		}
	}
	return out;
}

function mapEntry(
	entry: OpperCompatModel,
	filter: CatalogFilter,
): vscode.LanguageModelChatInformation | undefined {
	const meta = entry.opper;
	const kind = meta?.kind ?? 'model';

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
	if (filter.euOnly && kind !== 'dynamic_route' && meta?.region !== 'EU') {
		return undefined;
	}
	// `enterprise` means ZDR is *available* under terms, not that it is on.
	if (filter.zdrOnly && kind !== 'dynamic_route' && meta?.zdr !== 'always') {
		return undefined;
	}
	if (filter.modelFilter.length > 0) {
		const id = entry.id.toLowerCase();
		if (!filter.modelFilter.some((needle) => id.includes(needle.toLowerCase()))) {
			return undefined;
		}
	}

	const capabilities = meta?.capabilities ?? [];
	const isRoute = kind === 'dynamic_route';

	const contextLength = entry.context_length || (isRoute ? ROUTE_CONTEXT : 0);
	const maxOutputTokens =
		meta?.max_output_tokens || (isRoute ? ROUTE_MAX_OUTPUT : FALLBACK_OUTPUT_RESERVE);

	// A model with no context figure at all cannot be budgeted, and VS Code
	// will trim history against whatever number we give it. Skipping is safer
	// than inventing one.
	if (contextLength <= 0) {
		return undefined;
	}

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
		maxInputTokens: Math.max(1024, contextLength - maxOutputTokens),
		maxOutputTokens,
		capabilities: {
			toolCalling: isRoute ? filter.dynamicRouteToolCalling : capabilities.includes('tools'),
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
	if (meta?.zdr === 'always') {
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
	if (meta?.zdr) {
		lines.push(
			meta.zdr === 'always'
				? 'Zero data retention by default.'
				: `Zero data retention: ${meta.zdr}.`,
		);
	}
	if (meta?.verification) {
		lines.push(`Verification: ${meta.verification.replace(/_/g, ' ')}.`);
	}

	const price = priceLine(entry);
	if (price) {
		lines.push(price);
	}
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
