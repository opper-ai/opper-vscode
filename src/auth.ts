import * as vscode from 'vscode';

import { resolveKey, type ResolvedKey } from './identity';

const SECRET_KEY = 'opper.apiKey';

/**
 * Holds the Opper API key in VS Code's SecretStorage — the OS keychain, not
 * settings.json, so it never lands in a synced or committed file.
 */
export class Auth {
	private readonly changed = new vscode.EventEmitter<void>();
	readonly onDidChange = this.changed.event;

	constructor(private readonly secrets: vscode.SecretStorage) {}

	/**
	 * The key to use, and where it came from. Never prompts.
	 *
	 * A stored key wins over `OPPER_API_KEY` — see resolveKey. The reverse
	 * silently discards what the user typed into "Manage API Key".
	 */
	async resolve(): Promise<ResolvedKey | undefined> {
		return resolveKey(await this.secrets.get(SECRET_KEY), process.env.OPPER_API_KEY);
	}

	/** Just the key, for call paths that do not care about its origin. */
	async peekApiKey(): Promise<string | undefined> {
		return (await this.resolve())?.key;
	}

	/** The key, asking for one if there is none. */
	async requireApiKey(): Promise<string | undefined> {
		const existing = await this.peekApiKey();
		if (existing) {
			return existing;
		}
		return this.promptForApiKey();
	}

	async promptForApiKey(): Promise<string | undefined> {
		const entered = await vscode.window.showInputBox({
			title: 'Opper API Key',
			prompt: 'Paste an Opper API key. Create one at https://platform.opper.ai',
			placeHolder: 'op-...',
			password: true,
			ignoreFocusOut: true,
			validateInput: (value) =>
				value.trim().length === 0 ? 'An API key is required.' : undefined,
		});
		const key = entered?.trim();
		if (!key) {
			return undefined;
		}
		await this.secrets.store(SECRET_KEY, key);
		this.changed.fire();
		return key;
	}

	async clear(): Promise<void> {
		await this.secrets.delete(SECRET_KEY);
		this.changed.fire();
	}

	dispose(): void {
		this.changed.dispose();
	}
}
