const test = require('node:test');
const assert = require('node:assert/strict');
const { contextLimits, promptEstimate, contextSummary, estimateTokens } = require('../out/context.js');
const { ModelCatalog } = require('../out/model-catalog.js');
const { credentialFromResponse } = require('../out/device-login.js');
const { credentialError } = require('../out/login-errors.js');
test('context bounds reject invalid metadata and never exceed the actual window', () => {
 for (const ctx of [undefined, 0, -1, NaN, Infinity, 1.5]) assert.equal(contextLimits(ctx, 100), undefined);
 for (const out of [-1, 0, 1024, 2048, NaN]) assert.equal(contextLimits(1024, out), undefined);
 assert.deepEqual(contextLimits(1024, undefined), {input:768, output:256});
});
test('context estimates include tools and Unicode, and mark media as unknown', () => {
 const plain = promptEstimate({messages:[{content:'hello'}]});
 const tools = promptEstimate({messages:[{content:'hello'}],tools:[{function:{description:'long '.repeat(100)}}]});
 assert.ok(tools.tokens > plain.tokens);
 assert.ok(estimateTokens('你好') > estimateTokens('hi'));
 const image = promptEstimate({messages:[{content:[{type:'image_url', image_url:{url:'data:'.repeat(10000)}}]}]});
 assert.equal(image.hasMedia,true); assert.ok(image.tokens < 1000);
 assert.match(contextSummary('m', 500, 1000, false,true), /Remaining space is unknown/);
 assert.match(contextSummary('m', 500, 1000, true,false), /Server-reported/);
});
test('catalog switches keys, expires, and cannot resurrect an invalidated fetch', async () => {
 const c = new ModelCatalog(); let calls = 0; const fetcher = async () => [{id:String(++calls)}];
 await c.get('key-a',fetcher,0); await c.get('key-a',fetcher,1); assert.equal(calls,1);
 await c.get('key-b',fetcher,2); assert.equal(calls,2);
 await c.get('key-b',fetcher,60003); assert.equal(calls,3);
 let release; const pending=c.get('key-a',()=>new Promise(r=>release=r),60004);
 c.clear(); release([{id:'stale'}]); await pending;
 assert.notEqual((await c.get('key-a',fetcher,60005))[0].id,'stale');
 await assert.rejects(c.get('key-c',async()=>{throw Error('offline')},60006));
 assert.notEqual((await c.get('key-a',fetcher,60007))[0].id,'stale');
});
test('live login preserves agreed metadata without requiring it from legacy servers', () => {
 const opts={baseUrl:'https://api.opper.ai',platformUrl:'https://platform.opper.ai',clientId:'vscode',pilot:false};
 const c=credentialFromResponse({api_key:'synthetic',credential_id:'42',org_id:123,project_id:456,expires_at:null},opts);
 assert.equal(c.organizationId,'123'); assert.equal(c.projectId,'456'); assert.equal(c.credentialId,'42'); assert.equal(c.expiresAt,null);
 const date='2030-01-01T00:00:00Z';assert.equal(credentialFromResponse({api_key:'k',expires_at:date},opts).expiresAt,date);
 assert.throws(()=>credentialFromResponse({api_key:'k',expires_at:'invalid'},opts),/Invalid credential expiry/);
 assert.match(credentialError(401,'{}','credential_expired'),/expired/);
});
