import { OpperLogin } from '@opperai/login';
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
}
export function endpoint(value: string): string {
	const url = new URL(value);
	if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Opper endpoint must be an origin, without credentials or a path.');
	if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('Opper endpoints require HTTPS (HTTP is allowed only on loopback for local development).');
	return url.origin;
}
export function loginUrl(device: Device, platformUrl: string): string {
	const url = new URL(device.verification_uri_complete ?? device.verification_uri);
	if (url.origin !== endpoint(platformUrl)) throw new Error('Opper returned an unexpected approval website.');
	return url.href;
}
function text(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0; }
export function credentialFromResponse(data: Record<string, unknown>, options: LoginOptions): Credential {
	if (!text(data.api_key)) throw new Error('Opper returned no credential.');
	const c: Credential = { key: data.api_key, origin: endpoint(options.baseUrl), clientId: options.clientId };

	if (text(data.credential_id)) c.credentialId = data.credential_id;
	if (typeof data.org_id === 'number' && Number.isSafeInteger(data.org_id) && data.org_id > 0) c.organizationId = String(data.org_id);
	if (typeof data.project_id === 'number' && Number.isSafeInteger(data.project_id) && data.project_id > 0) c.projectId = String(data.project_id);
	if (data.expires_at === null) c.expiresAt = null;
	else if (data.expires_at !== undefined) {
		if (!text(data.expires_at) || !Number.isFinite(Date.parse(data.expires_at))) throw new Error('Invalid credential expiry returned by Opper.');
		c.expiresAt = data.expires_at;
	}
	return c;
}
export class DeviceLogin {
	private readonly shared: OpperLogin;
	constructor(private readonly options: LoginOptions) {
		endpoint(options.baseUrl); endpoint(options.platformUrl);
		this.shared = new OpperLogin({clientId:options.clientId,opperUrl:options.baseUrl,platformUrl:options.platformUrl});
		if (!options.clientId.trim()) throw new Error('Set opper.login.clientId to a registered public VS Code OAuth client. No CLI installation is required.');
	}
	async start(signal: AbortSignal, previous?: Credential): Promise<Device> {
            if (previous && (previous.clientId !== this.options.clientId || previous.origin !== endpoint(this.options.baseUrl))) throw new Error('Renew using the original client and endpoint.');
            const d = await this.shared.startDeviceAuth({signal, renew:!!previous, currentCredentialId:previous?.credentialId});
            const device: Device = {device_code:d.deviceCode,user_code:d.userCode,verification_uri:d.verificationUri,verification_uri_complete:d.verificationUriComplete,expires_in:d.expiresIn,interval:d.interval,issuedAt:Date.now()};
            if (!text(device.device_code) || !text(device.user_code) || !Number.isFinite(device.expires_in) || device.expires_in <= 0) throw new Error('Invalid Opper device response.');
            loginUrl(device,this.options.platformUrl);
            return device;
	}

	async poll(device: Device, signal: AbortSignal, previous?: Credential): Promise<Credential> {
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
}
