import * as vscode from 'vscode';

const SECRET_KEY = 'opper.apiKey';

/**
 * Holds the Opper API key in VS Code's SecretStorage — the OS keychain, not
 * settings.json, so it never lands in a synced or committed file.
 */
export class Auth {
	private readonly changed = new vscode.EventEmitter<void>();
	readonly onDidChange = this.changed.event;

	constructor(private readonly secrets: vscode.SecretStorage) {}

	/** The stored key, or undefined. Never prompts. */
	async peekApiKey(): Promise<string | undefined> {
		// An env var is the escape hatch for devcontainers and CI, where there
		// is no keychain and nobody to answer a prompt.
		const fromEnv = process.env.OPPER_API_KEY?.trim();
		if (fromEnv) {
			return fromEnv;
		}
		return (await this.secrets.get(SECRET_KEY))?.trim() || undefined;
	}

	/** The stored key, asking for one if there is none. */
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
