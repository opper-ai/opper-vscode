import * as vscode from 'vscode';

import { OpperClient } from './api';
import { DEFAULT_FILTER, toChatInformation, type CatalogFilter } from './catalog';
import { formatIdentity, identityWarning } from './identity';
import type { Auth } from './auth';

/**
 * Answers "which key am I actually using, and what does it scope me to?".
 *
 * Comply rules — model allowlists especially — are scoped to the key's
 * PROJECT. A picker showing 574 models when a project allowlist should have cut
 * it to 11 is indistinguishable, from inside VS Code, from the allowlist not
 * working. Reporting org / project / model count next to the key's origin turns
 * that from a server-side mystery into a visible mismatch.
 */
export async function describeCurrent(
	auth: Auth,
	baseUrl: string,
	filter: CatalogFilter,
): Promise<{ summary: string; warning?: string } | undefined> {
	const resolved = await auth.resolve();
	if (!resolved) {
		return undefined;
	}
	const client = new OpperClient(baseUrl, resolved.key);
	// One round-trip each, in parallel — this runs on an explicit user action,
	// never on the discovery path.
	const [me, entries] = await Promise.all([client.getMe(), client.listModels()]);
	const count = toChatInformation(entries, filter).length;
	return {
		summary: formatIdentity(me, count, resolved.source),
		warning: identityWarning(me),
	};
}

/**
 * The command behind the gear icon next to "Opper" in the model picker.
 *
 * With a key present it leads with the identity rather than jumping straight to
 * a password box: the common reason to open this is "why am I seeing these
 * models?", and the answer is the project name.
 */
export async function manageCommand(auth: Auth, baseUrl: string, filter: CatalogFilter): Promise<void> {
	let current: Awaited<ReturnType<typeof describeCurrent>>;
	try {
		current = await describeCurrent(auth, baseUrl, filter);
	} catch (err) {
		// A key that cannot be checked is still a key worth replacing, so fall
		// through to the menu rather than dead-ending on the error.
		current = { summary: `Opper · could not reach ${baseUrl}`, warning: String(err) };
	}

	if (!current) {
		await auth.promptForApiKey();
		await announce(auth, baseUrl, filter);
		return;
	}

	const replace = 'Replace API key';
	const signOut = 'Sign out';
	const picked = await vscode.window.showQuickPick([replace, signOut], {
		title: current.summary,
		placeHolder: current.warning ?? 'Opper',
	});
	if (picked === replace) {
		await auth.promptForApiKey();
		await announce(auth, baseUrl, filter);
	} else if (picked === signOut) {
		await auth.clear();
		void vscode.window.showInformationMessage('Opper API key removed.');
	}
}

/** Confirms what a newly entered key actually resolved to. */
export async function announce(auth: Auth, baseUrl: string, filter: CatalogFilter): Promise<void> {
	try {
		const now = await describeCurrent(auth, baseUrl, filter);
		if (!now) {
			return;
		}
		void vscode.window.showInformationMessage(now.summary);
		if (now.warning) {
			void vscode.window.showWarningMessage(now.warning);
		}
	} catch (err) {
		void vscode.window.showWarningMessage(
			`Opper key saved, but checking it failed: ${err instanceof Error ? err.message : String(err)}`,
		);
	}
}

export { DEFAULT_FILTER };
