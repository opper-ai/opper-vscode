import * as vscode from 'vscode';
import { OpperClient, OpperApiError } from './api';
import type { Auth } from './auth';
import { budgetRows } from './budget';

/** A fresh snapshot on each open/refresh; nothing persisted across credentials. */
export async function showBudget(auth: Auth, getBaseUrl: () => string): Promise<void> {
	const cancellation = new vscode.CancellationTokenSource();
	const controller = new AbortController();
	const cancel = () => { cancellation.cancel(); controller.abort(); };
	const subscriptions = [
		auth.onDidChange(cancel),
		vscode.workspace.onDidChangeConfiguration(event => { if (event.affectsConfiguration('opper.baseUrl')) cancel(); }),
	];
	try {
		while (!cancellation.token.isCancellationRequested) {
			const baseUrl = getBaseUrl();
			const resolved = await auth.resolve();
			if (!resolved) { await vscode.window.showInformationMessage('Sign in with Opper to see your project budget.'); return; }
			const me = await new OpperClient(baseUrl, resolved.key).getMe(AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]));
			if (cancellation.token.isCancellationRequested || getBaseUrl() !== baseUrl || (await auth.resolve())?.key !== resolved.key) return;
			const picked = await vscode.window.showQuickPick([
				...budgetRows(me).map(row => ({ ...row, action: 'detail' })),
				{ label: '$(refresh) Refresh budget', action: 'refresh' },
			], {
				title: `Opper budget · ${me.project?.name ?? 'Current project'} · ${me.organization?.name ?? 'Current organization'}`,
				placeHolder: `Updated ${new Date().toLocaleTimeString()} · Select Refresh budget to update`,
			}, cancellation.token);
			if (!picked) return;
			// Details can be read as a notification; refresh is explicit.
			if (picked.action === 'detail') {
				await vscode.window.showInformationMessage([picked.label, picked.description, picked.detail].filter(Boolean).join(' · '));
				return;
			}
		}
	} catch (error) {
		if (cancellation.token.isCancellationRequested) return;
		if (error instanceof OpperApiError && error.status === 401) await auth.handleFailure(error);
		else await vscode.window.showWarningMessage(error instanceof OpperApiError && error.status === 402
			? 'Spending is blocked. This server cannot yet show budget details while blocked. Contact your organization administrator.'
			: 'Could not load your Opper budget. Try Show Budget again.');
	} finally {
		for (const subscription of subscriptions) subscription.dispose();
		cancellation.dispose();
	}
}
