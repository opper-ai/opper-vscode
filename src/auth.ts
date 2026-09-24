import * as vscode from 'vscode';
import { resolveKey, type ResolvedKey } from './identity';
import { DeviceLogin, endpoint, loginUrl } from './device-login';
import { Sessions } from './session';

const SECRET_KEY = 'opper.apiKey';
export class Auth {
	private readonly changed = new vscode.EventEmitter<void>();
	readonly onDidChange = this.changed.event;
	private readonly sessions: Sessions;
	private busy = false;
	constructor(private readonly secrets: vscode.SecretStorage) {
		this.sessions = new Sessions(secrets);
		this.listener = secrets.onDidChange(() => this.changed.fire());
	}
	private readonly listener: vscode.Disposable;
	private origin(): string { return endpoint(vscode.workspace.getConfiguration('opper').get<string>('baseUrl') ?? 'https://api.opper.ai'); }
	async resolve(): Promise<ResolvedKey | undefined> {
		const c = await this.sessions.credential(this.origin());
		const saved = await this.sessions.read();
		if (saved) {
			return c ? { key: c.key, source: 'stored' } : undefined;
		}
		return resolveKey(await this.secrets.get(SECRET_KEY), process.env.OPPER_API_KEY);
	}
	async peekApiKey(): Promise<string | undefined> { return (await this.resolve())?.key; }
	async requireApiKey(): Promise<string | undefined> {
		const existing = await this.peekApiKey();
		if (existing) return existing;
		const choice = await vscode.window.showQuickPick(['Sign in with Opper', 'Enter API key'], { title: 'Connect Opper' });
		if (choice === 'Sign in with Opper') { await this.login(); return this.peekApiKey(); }
		if (choice === 'Enter API key') return this.promptForApiKey();
		return undefined;
	}
	async sessionSummary(): Promise<string | undefined> {
		const s = await this.sessions.read();
		if (!s || !('credential' in s)) return undefined;
		const c = s.credential;
		if (c.clientId === 'manual') return 'Manually supplied API key';
		return c.expiresAt ? `Credential ${c.credentialId} · expires ${c.expiresAt}` : 'Browser sign-in · expiry not supplied by the current server';
	}
	async login(renew = false): Promise<void> {
		if (this.busy) throw new Error('An Opper sign-in is already in progress in this window.');
		this.busy = true;
		try {
			const cfg = vscode.workspace.getConfiguration('opper');
			const opts = { baseUrl: this.origin(), platformUrl: cfg.get<string>('login.platformUrl') ?? 'https://platform.opper.ai', clientId: cfg.get<string>('login.clientId') ?? '', pilot: cfg.get<boolean>('login.simulator') ?? false };
			const flow = new DeviceLogin(opts);
			const s = await this.sessions.read();
			const previous = renew && s && 'credential' in s ? s.credential : undefined;
			if (renew && !previous) throw new Error('Sign in with Opper before renewing.');
			await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: renew ? 'Renew Opper sign-in' : 'Sign in with Opper', cancellable: true }, async (progress, token) => {
				const controller = new AbortController();
				const listener = token.onCancellationRequested(() => controller.abort());
				try {
					const d = await flow.start(AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]), previous);
					progress.report({ message: `Approve in your browser. Code: ${d.user_code}` });
					const opened = await vscode.env.openExternal(vscode.Uri.parse(loginUrl(d, opts.platformUrl)));
					if (!opened) throw new Error('Could not open the approval page. Check your browser and try again.');
					const credential = await flow.poll(d, controller.signal, previous);
					await this.sessions.save(credential);
					this.changed.fire();
					void vscode.window.showInformationMessage(await this.sessionSummary() ?? 'Signed in to Opper.');
				} catch (err) {
					if (!token.isCancellationRequested) throw err;
				} finally { listener.dispose(); }
			});
		} finally { this.busy = false; }
	}
	async retrySave(): Promise<void> { await this.sessions.retrySave(); this.changed.fire(); }
	async promptForApiKey(): Promise<string | undefined> {
		if (this.busy) throw new Error('Finish or cancel Opper browser approval first.');
		const entered = await vscode.window.showInputBox({ title: 'Opper API Key', prompt: 'Paste an Opper API key.', password: true, ignoreFocusOut: true, validateInput: v => v.trim() ? undefined : 'An API key is required.' });
		const key = entered?.trim();
		if (!key) return undefined;
		await this.sessions.save({ key, origin: this.origin(), clientId: 'manual' });
		this.changed.fire();
		return key;
	}
	async clear(): Promise<void> {
		if (this.busy) throw new Error('Finish or cancel Opper browser approval before signing out.');
		await this.sessions.signOut();
		await this.secrets.delete(SECRET_KEY);
		this.changed.fire();
	}
	dispose(): void { this.listener.dispose(); this.changed.dispose(); }
}
