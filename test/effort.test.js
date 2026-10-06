const test = require('node:test');
const assert = require('node:assert/strict');
const { supportedEfforts, reasoningOptions } = require('../out/effort.js');
const entry = { id: 'gpt-6.1-sol', opper: { kind: 'pool', reasoning: { supported: ['low', 'medium', 'high', 'xhigh', 'max'], default: 'medium' } } };
test('efforts use exact gateway metadata and never infer a pool union', () => {
 assert.deepEqual(supportedEfforts(entry), ['low', 'medium', 'high', 'xhigh', 'max']);
 assert.deepEqual(supportedEfforts({ ...entry, opper: { ...entry.opper, reasoning: { supported: ['medium', 'high'] } } }), ['medium', 'high']);
 for (const reasoning of [undefined, {}, { supported: [] }, { supported: 'high' }, { supported: [4, ''] }]) {
  assert.deepEqual(supportedEfforts({ ...entry, opper: { kind: 'model', reasoning } }), []);
 }
 assert.deepEqual(supportedEfforts({ ...entry, opper: { ...entry.opper, kind: 'dynamic_route' } }), []);
});
test('selected effort becomes the wire option and unrelated options survive', () => {
 assert.deepEqual(reasoningOptions(entry, { temperature: 0.5 }, 'max'), { temperature: 0.5, reasoning_effort: 'max' });
 assert.deepEqual(reasoningOptions(entry, { reasoningEffort: 'xhigh' }, 'low'), { reasoning_effort: 'xhigh' });
 assert.deepEqual(reasoningOptions(entry, { reasoning_effort: 'high' }), { reasoning_effort: 'high' });
 assert.deepEqual(reasoningOptions(entry, {}), {});
});
test('unsupported, malformed or conflicting explicit effort fails before inference', () => {
 for (const options of [{ reasoningEffort: 'ultra' }, { reasoning_effort: 2 }, { reasoning_effort: null }, { reasoningEffort: null }, { reasoningEffort: 'high', reasoning_effort: 'low' }]) {
  assert.throws(() => reasoningOptions(entry, options), /effort/i);
 }
 assert.throws(() => reasoningOptions({ id: 'plain', opper: { kind: 'model' } }, { reasoning_effort: 'high' }), /effort/i);
});
test('stale saved selection fails and can be reset to the gateway default', () => {
 const changed = { ...entry, opper: { kind: 'pool', reasoning: { supported: ['medium', 'high'] } } };
 assert.throws(() => reasoningOptions(changed, {}, 'max'), /Set Thinking Effort/);
 assert.deepEqual(reasoningOptions(changed, {}), {});
});
