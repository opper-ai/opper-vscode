/**
 * Backfills model metadata from the public `/v3/models` catalogue.
 *
 * `/v3/compat/models` reports `opper.type`, `opper.capabilities` and
 * `opper.max_output_tokens` — everything VS Code needs to declare a model —
 * but a gateway that predates those fields returns the compliance block alone.
 * Read literally, that means "no tool calling, no vision" for every model,
 * which silently removes Opper from agent mode. So when the discovery response
 * is missing them, the same facts are fetched from `/v3/models` (public, no
 * auth) and merged in.
 *
 * Concrete models only. Pools and dynamic routes are contributed by the very
 * gateway version that also reports capabilities, so an entry that needs
 * backfilling is by definition a plain catalog row.
 *
 * No `vscode` import — unit-tested under plain `node --test`.
 */

import type { OpperCompatModel } from './api';

export interface CatalogRow {
	id: string;
	type?: string;
	capabilities?: string[];
	context_window?: number;
	max_output_tokens?: number;
}

/** True when at least one entry is missing what the picker needs. */
export function needsEnrichment(entries: OpperCompatModel[]): boolean {
	return entries.some((e) => {
		const kind = e.opper?.kind ?? 'model';
		if (kind !== 'model') {
			return false;
		}
		return !e.opper?.capabilities?.length || !e.opper?.type;
	});
}

/** Returns entries with missing metadata filled in from the catalogue. */
export function enrich(entries: OpperCompatModel[], rows: CatalogRow[]): OpperCompatModel[] {
	const byId = new Map<string, CatalogRow>();
	for (const row of rows) {
		byId.set(row.id, row);
	}

	return entries.map((entry) => {
		const kind = entry.opper?.kind ?? 'model';
		if (kind !== 'model') {
			return entry;
		}
		const row = byId.get(entry.id);
		if (!row) {
			return entry;
		}
		const meta = { ...entry.opper, kind } as NonNullable<OpperCompatModel['opper']>;
		// Only fill gaps. Where the gateway spoke, it is authoritative — it
		// applies comply scoping and pool folding this catalogue knows nothing
		// about.
		if (!meta.type && row.type) {
			meta.type = row.type;
		}
		if (!meta.capabilities?.length && row.capabilities?.length) {
			meta.capabilities = row.capabilities;
		}
		if (!meta.max_output_tokens && row.max_output_tokens) {
			meta.max_output_tokens = row.max_output_tokens;
		}
		return {
			...entry,
			context_length: entry.context_length || row.context_window,
			opper: meta,
		};
	});
}
