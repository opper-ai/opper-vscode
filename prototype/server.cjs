// Synthetic local service only. No Opper/Entra authentication or real inference.
const http = require('node:http');
const { randomUUID } = require('node:crypto');
function simulator() {
  const devices = new Map();
  let active;
  const server = http.createServer(async (req, res) => {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const url = new URL(req.url, origin);
    let body = '';
    for await (const part of req) { body += part; if (body.length > 65536) { res.writeHead(413).end(); return; } }
    const form = new URLSearchParams(body);
    const json = (code, value) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
    if (url.pathname === '/oauth/device' && req.method === 'POST') {
      if (form.get('client_id') !== 'vscode-prototype') return json(400, { detail: 'invalid_client' });
      const id = randomUUID();
      devices.set(id, { intent: form.get('intent'), previous: form.get('credential_id'), client: form.get('client_id'), status: 'pending', until: Date.now() + 120000 });
      return json(200, { device_code: id, user_code: 'DEMO-ONLY', verification_uri: origin + '/activate', verification_uri_complete: origin + '/activate?device=' + id, expires_in: 120, interval: 1 });
    }
    if (url.pathname === '/activate' && req.method === 'GET') {
      const id = url.searchParams.get('device');
      if (!devices.has(id)) return json(404, {});
      res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Security-Policy': "default-src 'none'; form-action 'self'; base-uri 'none'" });
      return res.end(`<h1>Opper login simulator</h1><p>Synthetic user in demo-org. This does not verify SSO.</p><form method="post" action="/approve"><input type="hidden" name="device" value="${id}"><button name="decision" value="allow">Approve 45-second credential</button> <button name="decision" value="deny">Deny</button></form>`);
    }
    if (url.pathname === '/approve' && req.method === 'POST') {
      const d = devices.get(form.get('device'));
      if (!d || Date.now() >= d.until || d.status !== 'pending') return json(400, {});
      if (form.get('decision') !== 'allow') { d.status = 'denied'; return json(200, { message: 'Denied. Return to VS Code.' }); }
      if (d.intent === 'renew' && (!active || d.previous !== active.credential_id)) { d.status = 'conflict'; return json(409, { detail: 'renewal_conflict' }); }
      if (!active || d.intent === 'renew' || Date.parse(active.expires_at) <= Date.now()) {
        active = { api_key: 'synthetic-' + randomUUID(), credential_id: randomUUID(), user_id: 'demo-user', organization_id: 'demo-org', project_id: 'demo-vscode-project', client_id: d.client, expires_at: new Date(Date.now() + 45000).toISOString() };
      }
      d.status = 'approved'; d.credentialId = active.credential_id;
      return json(200, { message: 'Approved. Return to VS Code.' });
    }
    if (url.pathname === '/oauth/device/token' && req.method === 'POST') {
      const d = devices.get(form.get('device_code'));
      if (!d || Date.now() >= d.until) return json(400, { detail: 'expired_token' });
      if (d.client !== form.get('client_id')) return json(400, { detail: 'invalid_client' });
      if (d.status !== 'approved') return json(400, { detail: d.status === 'pending' ? 'authorization_pending' : d.status === 'denied' ? 'access_denied' : 'renewal_conflict' });
      if (!active || d.credentialId !== active.credential_id) return json(400, { detail: 'credential_superseded' });
      return json(200, active);
    }
    if (!active || req.headers.authorization !== `Bearer ${active.api_key}`) return json(401, { error: { code: 'credential_revoked' } });
    if (Date.parse(active.expires_at) <= Date.now()) return json(401, { error: { code: 'credential_expired' } });
    if (url.pathname === '/v3/me') return json(200, { organization: { name: 'demo-org' }, project: { name: 'demo-vscode-project' } });
    if (url.pathname === '/v3/compat/models') return json(200, { data: [{ id: 'prototype-model', context_length: 128000, opper: { kind: 'model', type: 'llm', max_output_tokens: 4096, capabilities: ['text', 'tools'] } }] });
    if (url.pathname === '/v3/compat/chat/completions') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end('data: ' + JSON.stringify({ choices: [{ delta: { content: 'Synthetic response: the VS Code credential reached the simulator.' }, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n'); return;
    }
    json(404, {});
  });
  return server;
}
module.exports = { simulator };
if (require.main === module) {
  const server = simulator(); server.listen(43187, '127.0.0.1', () => console.log('Synthetic Opper service: http://127.0.0.1:43187 (no live credentials)'));
}
