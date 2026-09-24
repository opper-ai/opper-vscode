/** Prototype's internal schema; pilot wire fields still require agreement with the API team. */
export interface Credential {
	key: string;
	origin: string;
	clientId: string;
	userId?: string;
	organizationId?: string;
	projectId?: string;
	credentialId?: string;
	expiresAt?: string | null;
}
export interface SecretStore {
	get(key: string): PromiseLike<string | undefined>;
	store(key: string, value: string): PromiseLike<void>;
}
export const SESSION_SLOT = 'opper.login.session.v1';
type Session = { credential: Credential } | { signedOut: true };

export function usable(c: Credential, origin: string, now = Date.now()): void {
	if (c.origin !== origin) throw new Error('Opper endpoint changed. Sign in again for this endpoint.');
	if (c.expiresAt != null && (!Number.isFinite(Date.parse(c.expiresAt)) || Date.parse(c.expiresAt) <= now)) {
		throw new Error('Opper credential expired. Run "Opper: Renew Sign-in".');
	}
}

export class Sessions {
	private pending?: Credential;
	constructor(private readonly secrets: SecretStore) {}
	async read(): Promise<Session | undefined> {
		const raw = await this.secrets.get(SESSION_SLOT);
		if (!raw) return undefined;
		const value = JSON.parse(raw) as Session;
		if ('signedOut' in value && value.signedOut === true) return value;
		if (!('credential' in value) || !value.credential?.key || !value.credential.origin || !value.credential.clientId) {
			throw new Error('Invalid saved Opper session. Sign in again.');
		}
		return value;
	}
	async credential(origin: string): Promise<Credential | undefined> {
		if (this.pending) throw new Error('Opper credential storage failed. Run "Opper: Retry Saving Sign-in" before making requests.');
		const s = await this.read();
		if (!s || !('credential' in s)) return undefined;
		usable(s.credential, origin);
		return s.credential;
	}
	async save(c: Credential): Promise<void> {
		this.pending = c;
		try {
			await this.secrets.store(SESSION_SLOT, JSON.stringify({ credential: c }));
			this.pending = undefined;
		} catch {
			throw new Error('Opper approved sign-in, but secure storage failed. Run "Opper: Retry Saving Sign-in" while this window stays open. If closed, sign in again to recover the active credential.');
		}
	}
	async retrySave(): Promise<void> {
		if (!this.pending) throw new Error('No pending Opper credential to save. Sign in again if recovery is needed.');
		await this.save(this.pending);
	}
	async signOut(): Promise<void> {
		await this.secrets.store(SESSION_SLOT, JSON.stringify({ signedOut: true }));
		this.pending = undefined;
	}
}
