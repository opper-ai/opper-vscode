const test = require('node:test');
const assert = require('node:assert');

const { resolveKey, formatIdentity, identityWarning } = require('../out/identity.js');

test('a stored key beats OPPER_API_KEY', () => {
	// The regression this guards: with the precedence inverted, a user who has
	// OPPER_API_KEY exported and launches VS Code from that shell enters a key
	// through "Manage API Key" and has it silently discarded. The picker is
	// then scoped to whatever project the env key belongs to, and every symptom
	// looks like a server-side comply bug.
	const got = resolveKey('op-stored', 'op-from-env');
	assert.deepStrictEqual(got, { key: 'op-stored', source: 'stored' });
});

test('the env var is used only when nothing is stored', () => {
	assert.deepStrictEqual(resolveKey(undefined, 'op-from-env'), {
		key: 'op-from-env',
		source: 'environment',
	});
	assert.deepStrictEqual(resolveKey('', 'op-from-env'), {
		key: 'op-from-env',
		source: 'environment',
	});
	// Whitespace-only is not a key.
	assert.deepStrictEqual(resolveKey('   ', 'op-from-env'), {
		key: 'op-from-env',
		source: 'environment',
	});
});

test('no key anywhere resolves to undefined', () => {
	assert.strictEqual(resolveKey(undefined, undefined), undefined);
	assert.strictEqual(resolveKey('  ', ''), undefined);
});

test('keys are trimmed, since they arrive via paste', () => {
	assert.deepStrictEqual(resolveKey(' op-stored\n', undefined), {
		key: 'op-stored',
		source: 'stored',
	});
});

const ME = {
	organization: { name: 'jose@opper.ai', plan: 'control_plane' },
	project: { name: 'n8n-test' },
	blocked: false,
};

test('the status line leads with the project, because that is what scopes comply', () => {
	assert.strictEqual(
		formatIdentity(ME, 17, 'stored'),
		'Opper · jose@opper.ai · project n8n-test · 17 models',
	);
});

test('a key sourced from the environment says so', () => {
	// Otherwise the user cannot tell why the key they typed is not in effect.
	assert.strictEqual(
		formatIdentity(ME, 574, 'environment'),
		'Opper · jose@opper.ai · project n8n-test · 574 models · key from $OPPER_API_KEY',
	);
});

test('an org-scoped key is called out, since no project allowlist applies to it', () => {
	const orgKey = { organization: { name: 'jose@opper.ai' } };
	assert.strictEqual(
		formatIdentity(orgKey, 574, 'stored'),
		'Opper · jose@opper.ai · org-scoped key (no project) · 574 models',
	);
});

test('one model is not pluralised', () => {
	assert.match(formatIdentity(ME, 1, 'stored'), /· 1 model$/);
});

test('a healthy key produces no warning', () => {
	assert.strictEqual(identityWarning(ME), undefined);
});

test('blocked spending warns, because discovery still succeeds', () => {
	// The picker looks perfectly healthy right up until the first message fails.
	const w = identityWarning({ ...ME, blocked: true, block_reason: 'balance_exhausted' });
	assert.match(w, /out of credits/);
	assert.match(w, /requests will fail/);

	assert.match(
		identityWarning({ ...ME, blocked: true, block_reason: 'project_spend_cap_hit' }),
		/project's spend cap/,
	);
	// An unknown reason is still reported rather than swallowed.
	assert.match(identityWarning({ ...ME, blocked: true, block_reason: 'something_new' }), /something_new/);
});
