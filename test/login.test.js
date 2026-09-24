const test = require('node:test');
const assert = require('node:assert/strict');
const { Sessions } = require('../out/session.js');
const { DeviceLogin, credentialFromResponse, loginUrl } = require('../out/device-login.js');
const { simulator } = require('../prototype/server.cjs');
const options = { baseUrl: 'http://127.0.0.1:43187', platformUrl: 'http://127.0.0.1:43187', clientId: 'vscode-prototype', pilot: true };
const response = () => ({ api_key: 'synthetic', credential_id: 'c1', user_id: 'u1', organization_id: 'o1', project_id: 'p1', client_id: options.clientId, expires_at: new Date(Date.now() + 60000).toISOString() });
function store() {
  const values = new Map();
  return { fail: false, async get(k) { return values.get(k); }, async store(k, v) { if (this.fail) throw Error('disk failed'); values.set(k,v); } };
}
test('secure session survives reload and binds credentials to endpoint', async () => {
  const s = store(); const c = credentialFromResponse(response(), options);
  await new Sessions(s).save(c);
  assert.equal((await new Sessions(s).credential(options.baseUrl)).key, c.key);
  await assert.rejects(new Sessions(s).credential('https://other.example'), /endpoint changed/);
});
test('expiry fails closed and signed-out marker survives restart', async () => {
  const s = store(); const sessions = new Sessions(s);
  await sessions.save({ ...credentialFromResponse(response(), options), expiresAt: '2020-01-01T00:00:00Z' });
  await assert.rejects(sessions.credential(options.baseUrl), /expired/);
  await sessions.signOut();
  assert.deepEqual(await new Sessions(s).read(), { signedOut: true });
});
test('failed storage blocks predecessor and retries replacement without another rotation', async () => {
  const s = store(); const sessions = new Sessions(s); const c = credentialFromResponse(response(), options);
  await sessions.save(c); s.fail = true;
  await assert.rejects(sessions.save({ ...c, key: 'replacement' }), /secure storage failed/);
  await assert.rejects(sessions.credential(options.baseUrl), /Retry Saving/);
  s.fail = false; await sessions.retrySave();
  assert.equal((await sessions.credential(options.baseUrl)).key, 'replacement');
});
test('renewal checks user, organization, client, origin and actual rotation', () => {
  const first = credentialFromResponse(response(), options);
  for (const field of ['user_id', 'organization_id', 'client_id']) {
    assert.throws(() => credentialFromResponse({ ...response(), [field]: 'wrong', api_key: 'new', credential_id: 'c2' }, options, first), /identity|another client/);
  }
  assert.throws(() => credentialFromResponse(response(), options, first), /did not rotate/);
  assert.throws(() => credentialFromResponse({ ...response(), expires_at: undefined }, options), /expires_at/);
});
test('legacy response does not invent expiry or identity', () => {
  assert.deepEqual(credentialFromResponse({ api_key: 'legacy' }, { ...options, pilot: false }), { key: 'legacy', origin: options.baseUrl, clientId: options.clientId });
});
test('refuses unexpected browser destinations and remote pilot endpoints', () => {
  assert.throws(() => loginUrl({ verification_uri: 'https://evil.example' }, options.platformUrl), /unexpected/);
  assert.throws(() => new DeviceLogin({ ...options, baseUrl: 'https://api.opper.ai' }), /local simulator/);
});
test('device HTTP flow: approve, retry poll, rotate, reject predecessor and superseded delivery', async t => {
  const server = simulator(); await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const flow = new DeviceLogin({ ...options, baseUrl: origin, platformUrl: origin });
  const signal = AbortSignal.timeout(10000);
  const approve = async d => fetch(origin + '/approve', { method: 'POST', body: new URLSearchParams({ device: d.device_code, decision: 'allow' }) });
  const d = await flow.start(signal); await approve(d); const first = await flow.poll(d, signal);
  assert.equal((await flow.poll(d, signal)).key, first.key);
  const renew = await flow.start(signal, first); await approve(renew); const replacement = await flow.poll(renew, signal, first);
  assert.notEqual(replacement.key, first.key);
  const me = key => fetch(origin + '/v3/me', { headers: { Authorization: `Bearer ${key}` } });
  assert.equal((await me(first.key)).status, 401); assert.equal((await me(replacement.key)).status, 200);
  await assert.rejects(flow.poll(d, signal), /approval failed/);
});
test('denial and cancellation do not produce a credential', async t => {
  const server = simulator(); await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const flow = new DeviceLogin({ ...options, baseUrl: origin, platformUrl: origin });
  const signal = AbortSignal.timeout(5000); const d = await flow.start(signal);
  await fetch(origin + '/approve', { method: 'POST', body: new URLSearchParams({ device: d.device_code, decision: 'deny' }) });
  await assert.rejects(flow.poll(d, signal), /denied/);
  await assert.rejects(flow.poll(d, AbortSignal.abort()), /abort/i);
});
test('failed first save also blocks use until recovered', async () => {
  const s = store(); s.fail = true; const sessions = new Sessions(s);
  await assert.rejects(sessions.save(credentialFromResponse(response(), options)), /storage failed/);
  await assert.rejects(sessions.credential(options.baseUrl), /Retry Saving/);
});
test('runtime errors distinguish expiry from revoked entitlement', () => {
  const { credentialError } = require('../out/login-errors.js');
  assert.match(credentialError(401, JSON.stringify({ error: { code: 'credential_expired' } })), /Renew/);
  for (const code of ['membership_removed', 'account_suspended']) {
    const message = credentialError(403, JSON.stringify({ error: { code } }));
    assert.match(message, /administrator/); assert.doesNotMatch(message, /Renew/);
  }
  assert.equal(credentialError(500, '{}'), undefined);
});
test('VS Code auth sign-out suppresses legacy and environment fallback after reload', async () => {
  const Module = require('node:module'); const original = Module._load;
  class Emitter { event = () => ({ dispose() {} }); fire() {} dispose() {} }
  const config = { baseUrl: options.baseUrl };
  Module._load = function(name, ...rest) {
    if (name === 'vscode') return { EventEmitter: Emitter, workspace: { getConfiguration: () => ({ get: k => config[k] }) } };
    return original.call(this, name, ...rest);
  };
  let Auth;
  try { ({ Auth } = require('../out/auth.js')); } finally { Module._load = original; }
  const s = store(); s.delete = async () => {}; s.onDidChange = () => ({ dispose() {} });
  await s.store('opper.apiKey', 'legacy-key');
  const oldEnv = process.env.OPPER_API_KEY; process.env.OPPER_API_KEY = 'synthetic-env';
  try {
    const auth = new Auth(s); assert.equal(await auth.peekApiKey(), 'legacy-key');
    await auth.clear(); assert.equal(await auth.peekApiKey(), undefined);
    const reopened = new Auth(s); assert.equal(await reopened.peekApiKey(), undefined);
    auth.dispose(); reopened.dispose();
  } finally { if (oldEnv === undefined) delete process.env.OPPER_API_KEY; else process.env.OPPER_API_KEY = oldEnv; }
});
