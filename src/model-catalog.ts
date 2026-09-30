import type { OpperCompatModel } from './api';
/** Cache is scoped to credential and origin; never reused across identities. */
export class ModelCatalog {
	private cached?: { scope: string; until: number; entries: OpperCompatModel[] };
	private generation = 0;
	clear(): void { this.generation++; this.cached = undefined; }
	async get(scope: string, fetcher: () => Promise<OpperCompatModel[]>, now = Date.now()): Promise<OpperCompatModel[]> {
		if (this.cached?.scope === scope && now < this.cached.until) return this.cached.entries;
		const generation = this.generation;
		try {
			const entries = await fetcher();
			if (generation === this.generation) this.cached = { scope, entries, until: now + 60000 };
			return entries;
		} catch (error) {
			if (generation === this.generation) this.cached = undefined;
			throw error;
		}
	}
}
