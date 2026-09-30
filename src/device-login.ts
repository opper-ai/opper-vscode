import { OpperLogin } from '@opperai/login';
import { setTimeout as delay } from 'node:timers/promises';
import type { Credential } from './session';

export interface Device {
	device_code: string;
	user_code: string;
	verification_uri: string;
	verification_uri_complete?: string;
	expires_in: number;
	interval: number;
	issuedAt?: number;
}
export interface LoginOptions {
	baseUrl: string;
	platformUrl: string;
	clientId: string;
	/** Only the local simulator implements this proposed wire contract today. */
	pilot: boolean;
}
export function endpoint(value: string): string {
	const url = new URL(value);
	if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Opper endpoint must be an origin, without credentials or a path.');
	if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('Opper endpoints require HTTPS (HTTP is allowed only on loopback for the simulator).');
	return url.origin;
}
export function loginUrl(device: Device, platformUrl: string): string {
	const url = new URL(device.verification_uri_complete ?? device.verification_uri);
	if (url.origin !== endpoint(platformUrl)) throw new Error('Opper returned an unexpected approval website.');
	return url.href;
}
function text(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0; }
export function credentialFromResponse(data: Record<string, unknown>, options: LoginOptions, previous?: Credential): Credential {
	if (!text(data.api_key)) throw new Error('Opper returned no credential.');
	const c: Credential = { key: data.api_key, origin: endpoint(options.baseUrl), clientId: options.clientId };
	// Retain additive backend metadata in live mode without requiring new fields on legacy servers.
	if (!options.pilot) {
		if (text(data.credential_id)) c.credentialId = data.credential_id;
		if (typeof data.org_id === 'number' && Number.isSafeInteger(data.org_id) && data.org_id > 0) c.organizationId = String(data.org_id);
		if (typeof data.project_id === 'number' && Number.isSafeInteger(data.project_id) && data.project_id > 0) c.projectId = String(data.project_id);
		if (data.expires_at === null) c.expiresAt = null;
		else if (data.expires_at !== undefined) {
			if (!text(data.expires_at) || !Number.isFinite(Date.parse(data.expires_at))) throw new Error('Invalid credential expiry returned by Opper.');
			c.expiresAt = data.expires_at;
		}
	}
	if (options.pilot) {
		for (const field of ['credential_id', 'user_id', 'organization_id', 'project_id', 'client_id', 'expires_at']) {
			if (!text(data[field])) throw new Error(`Pilot response missing ${field}.`);
		}
		if (data.client_id !== options.clientId) throw new Error('Opper returned a credential for another client.');
		if (!Number.isFinite(Date.parse(data.expires_at as string)) || Date.parse(data.expires_at as string) <= Date.now()) throw new Error('Opper returned an invalid or expired credential.');
		Object.assign(c, { credentialId: data.credential_id, userId: data.user_id, organizationId: data.organization_id, projectId: data.project_id, expiresAt: data.expires_at });
		if (previous && (previous.userId !== c.userId || previous.organizationId !== c.organizationId || previous.clientId !== c.clientId || previous.origin !== c.origin)) throw new Error('Renewal identity differs from the saved user, organization, client or endpoint.');
		if (previous && (previous.credentialId === c.credentialId || previous.key === c.key)) throw new Error('Renewal did not rotate the credential.');
	}
	return c;
}
export class DeviceLogin {
	private readonly shared: OpperLogin;
	constructor(private readonly options: LoginOptions) {
		endpoint(options.baseUrl); endpoint(options.platformUrl);
		this.shared = new OpperLogin({clientId:options.clientId,opperUrl:options.baseUrl,platformUrl:options.platformUrl});
		if (!options.clientId.trim()) throw new Error('Set opper.login.clientId to a registered public VS Code OAuth client. No CLI installation is required.');
		if (options.pilot && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(options.baseUrl).hostname)) throw new Error('The proposed pilot wire format is restricted to the local simulator until the server contract is agreed.');
	}
	private async post(path: string, fields: Record<string, string>, signal: AbortSignal): Promise<Response> {
		return fetch(`${endpoint(this.options.baseUrl)}${path}`, {
			method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams(fields), signal, redirect: 'error',
		});
	}
	async start(signal: AbortSignal, previous?: Credential): Promise<Device> {
		if (!this.options.pilot) {
            if (previous && (previous.clientId !== this.options.clientId || previous.origin !== endpoint(this.options.baseUrl))) throw new Error('Renew using the original client and endpoint.');
            const d = await this.shared.startDeviceAuth({signal, renew:!!previous, currentCredentialId:previous?.credentialId});
            const device: Device = {device_code:d.deviceCode,user_code:d.userCode,verification_uri:d.verificationUri,verification_uri_complete:d.verificationUriComplete,expires_in:d.expiresIn,interval:d.interval,issuedAt:Date.now()};
            if (!text(device.device_code) || !text(device.user_code) || !Number.isFinite(device.expires_in) || device.expires_in <= 0) throw new Error('Invalid Opper device response.');
            loginUrl(device,this.options.platformUrl);
            return device;
        }
		const fields: Record<string, string> = { client_id: this.options.clientId };
		if (previous) {
			if (!previous.userId || !previous.organizationId || !previous.credentialId || previous.clientId !== this.options.clientId || previous.origin !== endpoint(this.options.baseUrl)) throw new Error('This credential cannot be renewed with the configured pilot client.');
			Object.assign(fields, { intent: 'renew', user_id: previous.userId, organization_id: previous.organizationId, credential_id: previous.credentialId });
		}
		const res = await this.post('/oauth/device', fields, signal);
		if (!res.ok) throw new Error(`Opper could not start browser approval (${res.status}).`);
		const d = await res.json() as Device;
		if (!text(d.device_code) || !text(d.user_code) || !text(d.verification_uri) || !Number.isFinite(d.expires_in) || d.expires_in <= 0 || !Number.isFinite(d.interval) || d.interval < 0) throw new Error('Invalid Opper device response.');
		loginUrl(d, this.options.platformUrl);
		return d;
	}
	async poll(device: Device, signal: AbortSignal, previous?: Credential): Promise<Credential> {
        if (!this.options.pilot) {
            const remaining = device.expires_in - (device.issuedAt ? (Date.now()-device.issuedAt)/1000 : 0);
            if (remaining <= 0) throw new Error('Browser approval expired. Sign in again.');
            const result = await this.shared.pollDeviceToken({deviceCode:device.device_code,userCode:device.user_code,verificationUri:device.verification_uri,verificationUriComplete:device.verification_uri_complete,expiresIn:remaining,interval:device.interval},signal);
            signal.throwIfAborted();
            const c=credentialFromResponse({api_key:result.apiKey,credential_id:result.credentialId,org_id:result.orgId,project_id:result.projectId,expires_at:result.expiresAt},this.options);
            c.userEmail=result.user?.email;c.projectName=result.projectName;c.projectUuid=result.projectUuid;
            if (c.expiresAt && Date.parse(c.expiresAt)<=Date.now()) throw new Error('Opper returned an expired credential.');
            if(previous) {
                if(previous.organizationId && c.organizationId!==previous.organizationId || previous.userEmail && c.userEmail!==previous.userEmail) throw new Error('Renewal returned a different user or organization. Sign in normally to switch accounts.');
                if(c.key===previous.key || previous.credentialId && c.credentialId===previous.credentialId) throw new Error('Renewal did not replace the credential.');
            }
            return c;
        }
		let interval = Math.max(1, device.interval) * 1000;
		const deadline = Date.now() + device.expires_in * 1000;
		const bounded = AbortSignal.any([signal, AbortSignal.timeout(Math.ceil(device.expires_in * 1000))]);
		while (Date.now() < deadline) {
			await delay(interval, undefined, { signal: bounded });
			const res = await this.post('/oauth/device/token', { client_id: this.options.clientId, device_code: device.device_code }, bounded);
			const data = await res.json() as Record<string, unknown>;
			if (res.ok) return credentialFromResponse(data, this.options, previous);
			// The live API wraps HTTPException details in its standard errors envelope.
			const wrapped = Array.isArray(data.errors) ? data.errors[0] as Record<string, unknown> | undefined : undefined;
			const code = data.detail ?? wrapped?.detail ?? wrapped?.message ?? data.error;
			if (code === 'authorization_pending') continue;
			if (code === 'slow_down') { interval += 5000; continue; }
			const messages: Record<string, string> = {
				access_denied: 'Browser approval was denied.', expired_token: 'Browser approval expired. Sign in again.',
				membership_removed: 'Organization access was removed. Contact your administrator.',
				account_suspended: 'Your account is suspended. Contact your administrator.',
				sso_required: 'Sign in using your organization’s required SSO connection.',
			};
			throw new Error(messages[String(code)] ?? `Opper browser approval failed (${res.status}).`);
		}
		throw new Error('Browser approval expired. Sign in again.');
	}
}
