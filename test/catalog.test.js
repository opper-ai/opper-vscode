const test = require('node:test');
const assert = require('node:assert');

const { toChatInformation, kindQuery, zdrByDefault, DEFAULT_FILTER } = require('../out/catalog.js');

// What `opper.zdr` carries: retention facts, `true` = content is held. ZDR by
// default means logging is known-off and moderation is not known-on.
const ZDR = {
	logging: false,
	moderation: false,
	caching: false,
	training: false,
	subprocessors: false,
};

const CHAT = {
	id: 'anthropic/claude-sonnet-4.5',
	object: 'model',
	created: 1704067200,
	owned_by: 'anthropic',
	context_length: 200000,
	pricing: { prompt: '0.000003', completion: '0.000015' },
	opper: {
		kind: 'model',
		type: 'llm',
		capabilities: ['text', 'tools', 'vision', 'structured_output'],
		max_output_tokens: 64000,
		region: 'EU',
		country: 'Germany',
		zdr: ZDR,
		gdpr_residency: 'EU',
	},
};

// The catalogue really does ship embedding rows that claim `tools`; this is the
// row that would otherwise be offered as a tool-calling chat model.
const EMBEDDING = {
	id: 'openai/text-embedding-3-large',
	object: 'model',
	created: 1704067200,
	owned_by: 'openai',
	context_length: 8191,
	opper: { kind: 'model', type: 'embedding', capabilities: ['text', 'tools'], region: 'US' },
};

const POOL = {
	id: 'claude-sonnet-4.5',
	object: 'model',
	created: 1704067200,
	owned_by: 'opper',
	context_length: 180000,
	opper: {
		kind: 'pool',
		type: 'llm',
		members: ['anthropic/claude-sonnet-4.5', 'aws/claude-sonnet-4-5-eu'],
		capabilities: ['text', 'tools'],
		max_output_tokens: 32000,
		region: 'EU',
	},
};

const ROUTE = {
	id: 'dynamic/support',
	object: 'model',
	created: 1704067200,
	owned_by: 'opper',
	opper: { kind: 'dynamic_route', version: 3, description: 'Support triage' },
};

const map = (entries, overrides = {}) =>
	toChatInformation(entries, { ...DEFAULT_FILTER, ...overrides });
const byId = (list) => Object.fromEntries(list.map((m) => [m.id, m]));
const withZdr = (id, zdr) => ({ ...CHAT, id, opper: { ...CHAT.opper, zdr } });

test('an embedding model never reaches the chat picker', () => {
	const ids = map([CHAT, EMBEDDING]).map((m) => m.id);
	assert.deepStrictEqual(ids, ['anthropic/claude-sonnet-4.5']);
});

test('capabilities become VS Code capabilities', () => {
	const m = map([CHAT])[0];
	assert.strictEqual(m.capabilities.toolCalling, true);
	assert.strictEqual(m.capabilities.imageInput, true);
});

test('a model without vision does not claim image input', () => {
	const noVision = { ...CHAT, opper: { ...CHAT.opper, capabilities: ['text', 'tools'] } };
	assert.strictEqual(map([noVision])[0].capabilities.imageInput, false);
});

test('the reply gets budget carved out of the context window', () => {
	// 200000 total - 64000 reserved for the completion. Handing VS Code the
	// full window as input budget lets it fill the context and leave the reply
	// no room.
	const m = map([CHAT])[0];
	assert.strictEqual(m.maxInputTokens, 136000);
	assert.strictEqual(m.maxOutputTokens, 64000);
});

test('an unknown output cap still reserves something', () => {
	const noCap = { ...CHAT, opper: { ...CHAT.opper, max_output_tokens: undefined } };
	const m = map([noCap])[0];
	assert.strictEqual(m.maxOutputTokens, 4096);
	assert.strictEqual(m.maxInputTokens, 200000 - 4096);
});

test('a model with no context figure at all is skipped, not invented', () => {
	const noCtx = { ...CHAT, context_length: undefined };
	assert.deepStrictEqual(map([noCtx]), []);
});

test('pool and pinned model stay distinguishable in the picker', () => {
	// Pool first — see the ordering test below.
	const ids = map([CHAT, POOL]).map((m) => m.id);
	assert.deepStrictEqual(ids, ['claude-sonnet-4.5', 'anthropic/claude-sonnet-4.5']);
	const pool = byId(map([CHAT, POOL]))['claude-sonnet-4.5'];
	assert.match(pool.detail, /Pool of 2/);
	assert.strictEqual(pool.family, 'opper-pool');
});

test('residency and ZDR surface in the picker detail line', () => {
	const m = map([CHAT])[0];
	assert.strictEqual(m.detail, 'anthropic · Germany · ZDR');
	assert.match(m.tooltip, /Zero data retention: on by default\./);
	assert.match(m.tooltip, /\$3\.00 in \/ \$15\.00 out per 1M tokens/);
});

test('euOnly drops a non-EU model', () => {
	const us = { ...CHAT, id: 'openai/gpt-5', opper: { ...CHAT.opper, region: 'US' } };
	const ids = map([CHAT, us], { euOnly: true }).map((m) => m.id);
	assert.deepStrictEqual(ids, ['anthropic/claude-sonnet-4.5']);
});

test('zdrOnly derives "by default" from the retention facts', () => {
	// Logging must be known-off; moderation must not be known-on. A `null`
	// (not established, or a pool whose members disagree) only passes on the
	// moderation side.
	const moderated = withZdr('x/moderated', { ...ZDR, moderation: true });
	const unknownLog = withZdr('x/unknown-logging', { ...ZDR, logging: null });
	const unknownMod = withZdr('x/unknown-moderation', { logging: false, moderation: null });
	const ids = map([CHAT, moderated, unknownLog, unknownMod], { zdrOnly: true }).map((m) => m.id);
	assert.deepStrictEqual(ids, ['anthropic/claude-sonnet-4.5', 'x/unknown-moderation']);
});

test('zdrOnly never infers ZDR from a missing, null or malformed field', () => {
	const missing = withZdr('x/missing', undefined);
	const nul = withZdr('x/null', null);
	const junk = withZdr('x/junk', 'yes');
	assert.deepStrictEqual(map([missing, nul, junk], { zdrOnly: true }), []);
	assert.strictEqual(map([missing])[0].detail, 'anthropic · Germany');
});

test('the retired string form still reads: always is on, enterprise is not', () => {
	// Kept for the rollout window; the string leaves the wire with the facts.
	const always = withZdr('x/always', 'always');
	const ent = withZdr('x/ent', 'enterprise');
	const ids = map([always, ent], { zdrOnly: true }).map((m) => m.id);
	assert.deepStrictEqual(ids, ['x/always']);
	assert.strictEqual(map([always])[0].detail, 'anthropic · Germany · ZDR');
});

test('the tooltip names what blocks ZDR by default', () => {
	const moderated = withZdr('x/moderated', { ...ZDR, moderation: true });
	const unknownLog = withZdr('x/unknown-logging', { ...ZDR, logging: null });
	const got = byId(map([moderated, unknownLog]));
	assert.match(
		got['x/moderated'].tooltip,
		/Not zero data retention by default: moderation holds content\./,
	);
	assert.doesNotMatch(got['x/moderated'].detail, /ZDR/);
	assert.match(
		got['x/unknown-logging'].tooltip,
		/Not zero data retention by default: logging retention not established\./,
	);
});

test('zdrByDefault: the facts rule, and the retired string', () => {
	assert.strictEqual(zdrByDefault(ZDR), true);
	assert.strictEqual(zdrByDefault({ logging: false, moderation: null }), true);
	assert.strictEqual(zdrByDefault({ logging: false, moderation: true }), false);
	assert.strictEqual(zdrByDefault({ logging: null, moderation: false }), false);
	assert.strictEqual(zdrByDefault({ logging: true, moderation: false }), false);
	assert.strictEqual(zdrByDefault({}), false);
	assert.strictEqual(zdrByDefault('always'), true);
	assert.strictEqual(zdrByDefault('enterprise'), false);
	assert.strictEqual(zdrByDefault(null), false);
	assert.strictEqual(zdrByDefault(undefined), false);
	assert.strictEqual(zdrByDefault([]), false);
});

test('modelFilter matches on substring, case-insensitively', () => {
	const gpt = { ...CHAT, id: 'openai/GPT-5' };
	const ids = map([CHAT, gpt], { modelFilter: ['gpt'] }).map((m) => m.id);
	assert.deepStrictEqual(ids, ['openai/GPT-5']);
});

test('pools and routes can be hidden independently', () => {
	assert.deepStrictEqual(
		map([CHAT, POOL, ROUTE], { showPools: false }).map((m) => m.id),
		['dynamic/support', 'anthropic/claude-sonnet-4.5'],
	);
	assert.deepStrictEqual(
		map([CHAT, POOL, ROUTE], { showDynamicRoutes: false }).map((m) => m.id),
		['claude-sonnet-4.5', 'anthropic/claude-sonnet-4.5'],
	);
});

test('a dynamic route is listed with the version it would execute', () => {
	const r = map([ROUTE])[0];
	assert.strictEqual(r.id, 'dynamic/support');
	assert.strictEqual(r.version, '3');
	assert.match(r.detail, /Route v3/);
	assert.match(r.tooltip, /picks the model per request/);
});

test('a route never claims image input, and its tool calling is opt-out', () => {
	// Opper cannot know what the graph will pick, so tool calling is a promise
	// the user makes on the route's behalf.
	assert.strictEqual(map([ROUTE])[0].capabilities.toolCalling, true);
	assert.strictEqual(map([ROUTE])[0].capabilities.imageInput, false);
	assert.strictEqual(
		map([ROUTE], { dynamicRouteToolCalling: false })[0].capabilities.toolCalling,
		false,
	);
});

test('residency filters do not silently hide the org\'s own routes', () => {
	// A route has no region to report; filtering it out on euOnly would delete
	// the user's own deployed routing from the picker with no way to see why.
	assert.deepStrictEqual(
		map([ROUTE], { euOnly: true, zdrOnly: true }).map((m) => m.id),
		['dynamic/support'],
	);
});

test('all kinds selected sends no ?type= at all', () => {
	assert.strictEqual(kindQuery(DEFAULT_FILTER), undefined);
});

test('a subset becomes the API\'s own ?type= filter', () => {
	assert.strictEqual(
		kindQuery({ ...DEFAULT_FILTER, showModels: false }),
		'pool,dynamic_route',
	);
	assert.strictEqual(
		kindQuery({ ...DEFAULT_FILTER, showModels: false, showPools: false }),
		'dynamic_route',
	);
});

test('no kinds selected returns null, never an empty ?type=', () => {
	// `?type=` with an empty value means "every kind" to the gateway, so
	// sending it would return the whole catalogue — the exact opposite of what
	// unticking everything asks for. The caller must skip the request instead.
	assert.strictEqual(
		kindQuery({ ...DEFAULT_FILTER, showModels: false, showPools: false, showDynamicRoutes: false }),
		null,
	);
});

test('unticking models leaves only pools and routes', () => {
	const ids = map([CHAT, POOL, ROUTE], { showModels: false }).map((m) => m.id);
	assert.deepStrictEqual(ids, ['dynamic/support', 'claude-sonnet-4.5']);
});

test('routes and pools sort above concrete models', () => {
	// The gateway returns the reverse, which buries an org's handful of routes
	// and pools under several hundred catalog rows.
	const ids = map([CHAT, POOL, ROUTE]).map((m) => m.id);
	assert.deepStrictEqual(ids, [
		'dynamic/support',
		'claude-sonnet-4.5',
		'anthropic/claude-sonnet-4.5',
	]);
});

test('ordering is stable among concrete models', () => {
	// The gateway sorts featured-first; that must survive the kind grouping.
	const a = { ...CHAT, id: 'z/featured' };
	const b = { ...CHAT, id: 'a/ordinary' };
	assert.deepStrictEqual(
		map([a, b, POOL]).map((m) => m.id),
		['claude-sonnet-4.5', 'z/featured', 'a/ordinary'],
	);
});
