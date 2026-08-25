const test = require('node:test');
const assert = require('node:assert');

const { enrich, needsEnrichment } = require('../out/enrich.js');
const { toChatInformation, DEFAULT_FILTER } = require('../out/catalog.js');

/** What a gateway that predates the capability fields returns. */
const OLD_GATEWAY = [
	{
		id: 'anthropic/claude-sonnet-4.5',
		object: 'model',
		created: 1704067200,
		owned_by: 'anthropic',
		context_length: 200000,
		opper: { region: 'EU', country: 'Germany', zdr: 'always' },
	},
	{
		id: 'openai/text-embedding-3-large',
		object: 'model',
		created: 1704067200,
		owned_by: 'openai',
		context_length: 8191,
		opper: { region: 'US' },
	},
];

const CATALOG = [
	{
		id: 'anthropic/claude-sonnet-4.5',
		type: 'llm',
		capabilities: ['text', 'tools', 'vision'],
		context_window: 200000,
		max_output_tokens: 64000,
	},
	{
		id: 'openai/text-embedding-3-large',
		type: 'embedding',
		capabilities: ['text', 'tools'],
		context_window: 8191,
	},
];

test('an old gateway response is detected as needing backfill', () => {
	assert.strictEqual(needsEnrichment(OLD_GATEWAY), true);
});

test('a current gateway response needs no backfill and no extra request', () => {
	const current = [
		{
			id: 'a/b',
			object: 'model',
			created: 0,
			owned_by: 'a',
			opper: { kind: 'model', type: 'llm', capabilities: ['text', 'tools'] },
		},
	];
	assert.strictEqual(needsEnrichment(current), false);
});

test('pools and routes are never treated as needing backfill', () => {
	// They only exist on a gateway new enough to also report capabilities, and
	// neither has a row in /v3/models to backfill from.
	const entries = [
		{ id: 'claude-sonnet-4.5', object: 'model', created: 0, owned_by: 'opper', opper: { kind: 'pool' } },
		{ id: 'dynamic/support', object: 'model', created: 0, owned_by: 'opper', opper: { kind: 'dynamic_route' } },
	];
	assert.strictEqual(needsEnrichment(entries), false);
	assert.deepStrictEqual(enrich(entries, CATALOG), entries);
});

test('backfill restores tool calling, which is what makes agent mode work', () => {
	// Read literally, an old gateway's response says every model is incapable
	// of calling tools — which quietly removes Opper from agent mode.
	const before = toChatInformation(OLD_GATEWAY, DEFAULT_FILTER);
	assert.strictEqual(before[0].capabilities.toolCalling, false);

	const after = toChatInformation(enrich(OLD_GATEWAY, CATALOG), DEFAULT_FILTER);
	assert.strictEqual(after[0].capabilities.toolCalling, true);
	assert.strictEqual(after[0].capabilities.imageInput, true);
});

test('backfill supplies the type that keeps embeddings out of the picker', () => {
	const before = toChatInformation(OLD_GATEWAY, DEFAULT_FILTER).map((m) => m.id);
	assert.ok(before.includes('openai/text-embedding-3-large'), 'precondition: leaks without type');

	const after = toChatInformation(enrich(OLD_GATEWAY, CATALOG), DEFAULT_FILTER).map((m) => m.id);
	assert.deepStrictEqual(after, ['anthropic/claude-sonnet-4.5']);
});

test('the gateway wins wherever it spoke', () => {
	// It applies comply scoping and pool folding the public catalogue knows
	// nothing about, so backfill fills gaps only.
	const entry = {
		id: 'anthropic/claude-sonnet-4.5',
		object: 'model',
		created: 0,
		owned_by: 'anthropic',
		context_length: 150000,
		opper: { kind: 'model', type: 'llm', capabilities: ['text'], max_output_tokens: 8192 },
	};
	const [got] = enrich([entry], CATALOG);
	assert.deepStrictEqual(got.opper.capabilities, ['text']);
	assert.strictEqual(got.opper.max_output_tokens, 8192);
	assert.strictEqual(got.context_length, 150000);
});

test('a model absent from the catalogue is passed through untouched', () => {
	const entry = { id: 'private/byok-model', object: 'model', created: 0, owned_by: 'private', opper: {} };
	assert.deepStrictEqual(enrich([entry], CATALOG), [entry]);
});
