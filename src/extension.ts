import * as vscode from 'vscode';

import { Auth } from './auth';
import { OpperChatModelProvider, baseUrl, readFilter } from './provider';
import { manageCommand } from './status';

/** Must match `contributes.languageModelChatProviders[].vendor`. */
const VENDOR = 'opper';

export function activate(context: vscode.ExtensionContext): void {
	const auth = new Auth(context.secrets);
	const provider = new OpperChatModelProvider(auth);

	context.subscriptions.push(
		auth,
		provider,
		vscode.lm.registerLanguageModelChatProvider(VENDOR, provider),

		// Storing a key changes which models exist, so the picker has to be
		// told rather than waiting for its next refresh.
		auth.onDidChange(() => provider.refresh()),

		// The gear icon next to "Opper" in the model picker — declared as
		// contributes.languageModelChatProviders[].managementCommand.
		vscode.commands.registerCommand('opper.manage', () =>
			manageCommand(auth, baseUrl(), readFilter()),
		),

		vscode.commands.registerCommand('opper.signOut', async () => {
			await auth.clear();
			void vscode.window.showInformationMessage('Opper API key removed.');
		}),

		// A changed base URL or filter changes the catalogue too.
		vscode.workspace.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration('opper')) {
				provider.refresh();
			}
		}),
	);
}

export function deactivate(): void {
	// Everything is registered through context.subscriptions.
}
