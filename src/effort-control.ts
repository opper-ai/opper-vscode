import * as vscode from 'vscode';
import type { OpperCompatModel } from './api';
import { supportedEfforts } from './effort';

type Preferences = Record<string, Record<string, string>>;
function originScope(baseUrl: string): string { return baseUrl.replace(/\/+$/, ''); }
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function preferences(): Preferences {
	const raw = vscode.workspace.getConfiguration('opper').get<unknown>('thinkingEffort', {});
	if (!isRecord(raw)) return {};
	return Object.fromEntries(Object.entries(raw).filter(([, models]) => isRecord(models)).map(([scope, models]) => [
		scope, Object.fromEntries(Object.entries(models as Record<string, unknown>).filter((item): item is [string, string] => typeof item[1] === 'string')),
	]));
}
export function savedEffort(baseUrl: string, modelId: string): string | undefined {
	const all = preferences();
	const scope = originScope(baseUrl);
	const models = Object.hasOwn(all, scope) ? all[scope] : undefined;
	return models && Object.hasOwn(models, modelId) ? models[modelId] : undefined;
}

/** Stable VS Code UI: the native Thinking Effort schema API is still proposed. */
export async function chooseEffort(entries: OpperCompatModel[], baseUrl: string): Promise<void> {
	const items = entries.filter(entry => supportedEfforts(entry).length > 0 || savedEffort(baseUrl, entry.id) !== undefined)
		.map(entry => ({ label: entry.id, description: `Saved effort: ${savedEffort(baseUrl, entry.id) ?? 'server default'}`, entry }));
	if (items.length === 0) {
		void vscode.window.showInformationMessage('No available Opper models advertise configurable thinking effort.');
		return;
	}
	const model = await vscode.window.showQuickPick(items, { title: 'Opper — select a model or pool', placeHolder: 'Thinking effort is saved for this model across conversations' });
	if (!model) return;
	const declaredDefault = model.entry.opper?.reasoning?.default;
	const levels = supportedEfforts(model.entry);
	const effort = await vscode.window.showQuickPick([
		{ label: 'Server default', description: levels.includes(declaredDefault ?? '') ? declaredDefault : undefined, value: undefined as string | undefined },
		...levels.map(value => ({ label: value, description: value === savedEffort(baseUrl, model.entry.id) ? 'Saved' : undefined, value })),
	], { title: `Thinking effort — ${model.label}`, placeHolder: 'Higher effort can use more tokens and take longer' });
	if (!effort) return;
	const scope = originScope(baseUrl);
	const all = preferences();
	if (originScope(vscode.workspace.getConfiguration('opper').get<string>('baseUrl', 'https://api.opper.ai')) !== scope) {
		throw new Error('Opper endpoint changed while choosing thinking effort. Run the command again.');
	}
	let models = { ...(Object.hasOwn(all, scope) ? all[scope] : {}) };
	if (effort.value === undefined) delete models[model.entry.id];
	else models = { ...models, [model.entry.id]: effort.value };
	const next = { ...all, [scope]: models };
	if (Object.keys(models).length === 0) delete next[scope];
	await vscode.workspace.getConfiguration('opper').update('thinkingEffort', next, vscode.ConfigurationTarget.Global);
}
