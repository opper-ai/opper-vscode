import * as vscode from 'vscode';

import { OpperClient } from './api';
import { DEFAULT_FILTER, kindQuery, toChatInformation, type CatalogFilter } from './catalog';
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
	const [me, entries] = await Promise.all([client.getMe(), client.listModels(kindQuery(filter) ?? undefined)]);
	const count = toChatInformation(entries, filter).length;
	return {
		summary: [formatIdentity(me, count, resolved.source), await auth.sessionSummary()].filter(Boolean).join(' · '),
		warning: identityWarning(me),
	};
}

interface KindItem extends vscode.QuickPickItem {
	setting: 'showModels' | 'showPools' | 'showDynamicRoutes';
}

/**
 * Checkboxes for which kinds the picker lists.
 *
 * This exists on the gear menu rather than only in Settings because the
 * question it answers — "how do I see just my routes?" — is asked while
 * standing in the model picker, and Settings is two navigations away. The
 * boxes write the same three settings, so either route works and they stay in
 * sync.
 */
export async function chooseKinds(filter: CatalogFilter): Promise<void> {
	const items: KindItem[] = [
		{
			label: 'Models',
			description: 'Concrete catalog rows — anthropic/claude-sonnet-4.5',
			setting: 'showModels',
			picked: filter.showModels,
		},
		{
			label: 'Pools',
			description: 'Bare names that load-balance across providers — claude-sonnet-4.5',
			setting: 'showPools',
			picked: filter.showPools,
		},
		{
			label: 'Dynamic routes',
			description: "Your org's deployed routing graphs — dynamic/<name>",
			setting: 'showDynamicRoutes',
			picked: filter.showDynamicRoutes,
		},
	];

	const chosen = await vscode.window.showQuickPick(items, {
		canPickMany: true,
		title: 'Opper — what to list in the model picker',
		placeHolder: 'Untick Models to see only your pools and routes',
	});
	if (!chosen) {
		return; // dismissed — leave the settings alone
	}

	const cfg = vscode.workspace.getConfiguration('opper');
	const on = new Set(chosen.map((c) => c.setting));
	// Written globally: which kinds you want listed is a preference about you,
	// not about the folder you happen to have open.
	await Promise.all(
		items.map((i) => cfg.update(i.setting, on.has(i.setting), vscode.ConfigurationTarget.Global)),
	);

	if (on.size === 0) {
		void vscode.window.showWarningMessage(
			'Opper will list no models at all. Re-open "Opper: Choose What to List" to bring some back.',
		);
	}
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
		current = { summary: (await auth.sessionSummary()) ?? 'Opper · sign-in needs attention', warning: String(err) };
	}

	if (!current) {
		await auth.requireApiKey();
		await announce(auth, baseUrl, filter);
		return;
	}

	const choose = 'Choose what to list…';
	const settings = 'Open Opper settings…';
	const replace = 'Replace API key';
	const signOut = 'Sign out';
	const picked = await vscode.window.showQuickPick(
		[
			{ label: choose, description: kindSummary(filter) },
			{ label: settings, description: 'Display preferences and connection settings' },
			{ label: 'Show budget' },
			{ label: 'Refresh allowed models' },
			{ label: 'Show last request context' },
			{ label: 'Sign in with Opper' },
			...(vscode.workspace.getConfiguration('opper').get<boolean>('login.simulator') ? [{ label: 'Renew sign-in' }] : []),
			{ label: 'Retry saving sign-in' },
			{ label: replace },
			{ label: signOut },
		],
		{ title: current.summary, placeHolder: current.warning ?? 'Opper' },
	);
	switch (picked?.label) {
		case 'Show budget': await vscode.commands.executeCommand('opper.budget'); break;
		case 'Refresh allowed models': await vscode.commands.executeCommand('opper.refreshModels'); break;
		case 'Show last request context': await vscode.commands.executeCommand('opper.context'); break;
		case 'Sign in with Opper': await auth.login(); break;
		case 'Renew sign-in': await auth.login(true); break;
		case 'Retry saving sign-in': await auth.retrySave(); break;
		case choose:
			await chooseKinds(filter);
			break;
		case settings:
			await vscode.commands.executeCommand('workbench.action.openSettings', 'opper.');
			break;
		case replace:
			await auth.promptForApiKey();
			await announce(auth, baseUrl, filter);
			break;
		case signOut:
			await auth.clear();
			void vscode.window.showInformationMessage('Signed out locally. Server authorization is unchanged.');
			break;
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

/** "Models, pools, routes" — what the kind checkboxes currently allow. */
export function kindSummary(filter: CatalogFilter): string {
	const on: string[] = [];
	if (filter.showModels) {
		on.push('models');
	}
	if (filter.showPools) {
		on.push('pools');
	}
	if (filter.showDynamicRoutes) {
		on.push('routes');
	}
	return on.length > 0 ? on.join(', ') : 'nothing';
}

export { DEFAULT_FILTER };
