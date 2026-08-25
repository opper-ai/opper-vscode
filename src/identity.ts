/**
 * Key resolution and the one-line status that makes scoping visible.
 *
 * No `vscode` import — the precedence rule and the summary are exactly the
 * parts worth testing, and both are pure.
 */

import type { OpperIdentity } from './api';

export type KeySource = 'stored' | 'environment';

export interface ResolvedKey {
	key: string;
	source: KeySource;
}

/**
 * Decides which key wins.
 *
 * The stored key ALWAYS beats `OPPER_API_KEY`. The env var exists for
 * devcontainers and CI, where there is no keychain and nobody to answer a
 * prompt — it is a fallback, not an override. Letting it win meant a user who
 * had `OPPER_API_KEY` exported in their shell and launched VS Code from that
 * shell would enter a key through "Manage API Key" and have it silently
 * ignored, with the picker scoped to a project they never chose. Every symptom
 * of that looks like a server-side comply bug.
 */
export function resolveKey(
	stored: string | undefined,
	env: string | undefined,
): ResolvedKey | undefined {
	const s = stored?.trim();
	if (s) {
		return { key: s, source: 'stored' };
	}
	const e = env?.trim();
	if (e) {
		return { key: e, source: 'environment' };
	}
	return undefined;
}

/**
 * The status line shown after entering a key and whenever the management
 * command runs.
 *
 * It leads with the PROJECT because comply rules — model allowlists above all —
 * are scoped to the key's project. A picker showing every model when you
 * expected ten is almost always a key pointing at the wrong project, and
 * nothing else in the UI says which project you are on.
 */
export function formatIdentity(
	me: OpperIdentity,
	modelCount: number,
	source: KeySource,
): string {
	const org = me.organization?.name ?? 'unknown org';
	const project = me.project?.name;
	const parts = [`Opper · ${org}`];
	parts.push(project ? `project ${project}` : 'org-scoped key (no project)');
	parts.push(`${modelCount} ${modelCount === 1 ? 'model' : 'models'}`);
	if (source === 'environment') {
		parts.push('key from $OPPER_API_KEY');
	}
	return parts.join(' · ');
}

/** A warning worth interrupting for, or undefined when all is well. */
export function identityWarning(me: OpperIdentity): string | undefined {
	if (me.blocked) {
		const why =
			me.block_reason === 'balance_exhausted'
				? 'the organization is out of credits'
				: me.block_reason === 'project_spend_cap_hit'
					? "the project's spend cap is reached"
					: me.block_reason === 'org_spend_cap_hit'
						? "the organization's spend cap is reached"
						: (me.block_reason ?? 'spending is blocked');
		// Discovery still succeeds when spending is blocked, so the picker looks
		// healthy right up until the first message fails.
		return `Opper spending is blocked — ${why}. Models will list but requests will fail.`;
	}
	return undefined;
}
