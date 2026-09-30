const test = require('node:test');
const assert = require('node:assert/strict');
const { Sessions } = require('../out/session.js');
const { DeviceLogin, credentialFromResponse, loginUrl } = require('../out/device-login.js');
const options = { baseUrl: 'http://127.0.0.1:43187', platformUrl: 'http://127.0.0.1:43187', clientId: 'vscode-prototype' };
const response = () => ({ api_key: 'synthetic', credential_id: 'c1', user_id: 'u1', org_id: 1, project_id: 2, client_id: options.clientId, expires_at: new Date(Date.now() + 60000).toISOString() });
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
test('legacy response does not invent expiry or identity', () => {
  assert.deepEqual(credentialFromResponse({ api_key: 'legacy' }, { ...options }), { key: 'legacy', origin: options.baseUrl, clientId: options.clientId });
});
test('refuses unexpected browser destinations', () => {
  assert.throws(() => loginUrl({ verification_uri: 'https://evil.example' }, options.platformUrl), /unexpected/);
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

 test('live error envelope keeps polling while browser approval is pending', async () => {
  const original = global.fetch; let polls = 0;
  global.fetch = async () => ++polls <= 2
    ? new Response(JSON.stringify({ errors: [{ type: 'HTTPException', message: 'authorization_pending', detail: 'authorization_pending' }] }), { status: 400 })
    : new Response(JSON.stringify({ api_key: 'synthetic-approved' }), { status: 200 });
  try {
    const flow = new DeviceLogin({ ...options });
    const result = await flow.poll({ device_code: 'synthetic', expires_in: 10, interval: 1 }, AbortSignal.timeout(8000));
    assert.equal(result.key, 'synthetic-approved'); assert.equal(polls, 3);
  } finally { global.fetch = original; }
 });
 test('live error envelope reports denial instead of a generic HTTP error', async () => {
  const original = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({ errors: [{ detail: 'access_denied' }] }), { status: 400 });
  try {
    await assert.rejects(new DeviceLogin({ ...options }).poll({ device_code: 'synthetic', expires_in: 10, interval: 1 }, AbortSignal.timeout(5000)), /denied/);
  } finally { global.fetch = original; }
 });
test('shared live flow sends renewal fields and preserves metadata',async()=>{
 const original=global.fetch;let fields;
 const live={...options};
 const previous={key:'old',origin:options.baseUrl,clientId:options.clientId,credentialId:'10',organizationId:'1',userEmail:'dev@example.invalid'};
 global.fetch=async(url,init)=>{
  if(url.endsWith('/device')){fields=Object.fromEntries(init.body);return Response.json({device_code:'device',user_code:'CODE',verification_uri:options.platformUrl+'/activate',expires_in:10,interval:1});}
  return Response.json({api_key:'new',credential_id:'11',org_id:1,project_id:2,project_uuid:'project-uuid',project_name:'Developer project',user:{email:'dev@example.invalid'},expires_at:new Date(Date.now()+60000).toISOString()});
 };
 try{const flow=new DeviceLogin(live);const d=await flow.start(AbortSignal.timeout(5000),previous);const c=await flow.poll(d,AbortSignal.timeout(5000),previous);assert.equal(fields.renew,'true');assert.equal(fields.current_credential_id,'10');assert.equal(c.credentialId,'11');assert.equal(c.projectName,'Developer project');assert.equal(c.userEmail,previous.userEmail);}finally{global.fetch=original;}
});
test('cancelled shared polling makes no token request',async()=>{
 const original=global.fetch;let requests=0;global.fetch=async()=>{requests++;throw Error('should not request');};
 try{await assert.rejects(new DeviceLogin({...options}).poll({device_code:'test',expires_in:600,interval:5},AbortSignal.abort()),/abort/i);assert.equal(requests,0);}finally{global.fetch=original;}
});

 test('renewal rejects changed identity and unchanged credentials', async () => {
 const original = global.fetch;
 const previous = { key: 'old', credentialId: '1', organizationId: '1', userEmail: 'dev@example.invalid', origin: options.baseUrl, clientId: options.clientId };
 const good = { api_key: 'replacement', credential_id: '2', org_id: 1, user: { email: previous.userEmail } };
 try {
  for (const override of [{org_id:2}, {user:{email:'other@example.invalid'}}, {api_key:'old'}, {credential_id:'1'}]) {
   global.fetch = async () => Response.json({...good,...override});
   await assert.rejects(new DeviceLogin(options).poll({device_code:'test',expires_in:10,interval:1}, AbortSignal.timeout(5000), previous), /different user|did not replace/);
  }
  await assert.rejects(new DeviceLogin(options).start(AbortSignal.timeout(1000), {...previous,clientId:'other'}), /original client/);
 } finally { global.fetch=original; }
 });
