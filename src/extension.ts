import * as vscode from 'vscode';

import { showBudget } from './budget-view';
import { Auth } from './auth';
import { OpperChatModelProvider, baseUrl, readFilter } from './provider';
import { chooseKinds, manageCommand } from './status';

/** Must match `contributes.languageModelChatProviders[].vendor`. */
const VENDOR = 'opper';

export function activate(context: vscode.ExtensionContext): void {
	const auth = new Auth(context.secrets);
	const provider = new OpperChatModelProvider(auth);
	let lastFocusRefresh = 0;
	const refreshTimer = setInterval(() => { if (vscode.window.state.focused) provider.refresh(); }, 60000);

	context.subscriptions.push(
		auth,
		{ dispose: () => clearInterval(refreshTimer) },
		vscode.commands.registerCommand('opper.refreshModels', () => { provider.refresh(); void vscode.window.showInformationMessage('Opper model refresh requested. The picker uses your current key’s allowed models.'); }),
		vscode.commands.registerCommand('opper.budget', () => showBudget(auth, baseUrl)),
		vscode.commands.registerCommand('opper.context', () => provider.showContext()),
		vscode.window.onDidChangeWindowState(state => {
			if (state.focused && Date.now() - lastFocusRefresh > 60000) { lastFocusRefresh = Date.now(); provider.refresh(); }
		}),
		vscode.commands.registerCommand('opper.signIn', () => run(() => auth.login())),
		vscode.commands.registerCommand('opper.renew', () => run(() => auth.login(true))),
		vscode.commands.registerCommand('opper.retrySave', () => run(() => auth.retrySave())),
		provider,
		vscode.lm.registerLanguageModelChatProvider(VENDOR, provider),

		// Storing a key changes which models exist, so the picker has to be
		// told rather than waiting for its next refresh.
		auth.onDidChange(() => { provider.resetContext(); provider.refresh(); }),

		// The gear icon next to "Opper" in the model picker — declared as
		// contributes.languageModelChatProviders[].managementCommand.
		vscode.commands.registerCommand('opper.manage', () =>
			run(() => manageCommand(auth, baseUrl(), readFilter())),
		),

		vscode.commands.registerCommand('opper.chooseKinds', () => chooseKinds(readFilter())),

		vscode.commands.registerCommand('opper.signOut', () => run(async () => {
			await auth.clear();
			void vscode.window.showInformationMessage('Signed out locally. Server authorization is unchanged.');
		})),

		// A changed base URL or filter changes the catalogue too.
		vscode.workspace.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration('opper')) {
				provider.resetContext();
				provider.refresh();
			}
		}),
	);
}

export function deactivate(): void {
	// Everything is registered through context.subscriptions.
}

async function run(action: () => Promise<unknown>): Promise<void> {
	try { await action(); } catch (err) {
		void vscode.window.showErrorMessage(err instanceof Error ? err.message : 'Opper sign-in failed.');
	}
}
