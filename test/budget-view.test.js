const test=require('node:test');
const assert=require('node:assert/strict');
const Module=require('node:module');const original=Module._load;
const noop={dispose(){}};let onConfig,onAuth;
const panels=[];
const vs={ViewColumn:{Beside:2},workspace:{onDidChangeConfiguration(fn){onConfig=fn;return noop;}},window:{createWebviewPanel(){let onDispose;const p={webview:{html:'',onDidReceiveMessage(fn){p.receive=fn;return noop;}},reveal(){},onDidDispose(fn){onDispose=fn;return noop;},dispose(){p.disposed=true;onDispose?.();}};panels.push(p);return p;}}};
Module._load=function(n,...args){return n==='vscode'?vs:original.call(this,n,...args);};const {BudgetView}=require('../out/budget-view.js');Module._load=original;
const auth=()=>({resolve:async()=>({key:'synthetic'}),onDidChange(fn){onAuth=fn;return noop;}});
test('budget panel refreshes real /me snapshots and footer summary',async()=>{
 const old=global.fetch;let calls=0,summary;global.fetch=async url=>{assert.equal(url,'https://api.example/v3/me');return Response.json({project:{name:'Dev'},project_spend:{currency:'usd',spent_cents:++calls*100,limit_cents:1000,remaining_cents:900,limit_scope:'project'}});};
 const view=new BudgetView(auth(),()=> 'https://api.example',s=>summary=s);
 try{await view.show();assert.match(panels.at(-1).webview.html,/USD 1.00/);assert.match(summary,/USD 1.00 used of USD 10.00/);await view.refresh();assert.equal(calls,1);await view.refresh(true);assert.match(panels.at(-1).webview.html,/USD 2.00/);}finally{view.dispose();global.fetch=old;}
});
test('identity or origin change cancels display and discards in-flight response',async()=>{
 const old=global.fetch;
 try{for(const change of [()=>onAuth(),()=>onConfig({affectsConfiguration:()=>true})]){
  let summary;const view=new BudgetView(auth(),()=> 'https://api.example',s=>summary=s);
  global.fetch=async()=>{change();return Response.json({project_spend:{spent_cents:99999,currency:'usd'}});};
  await view.show();assert.equal(summary,undefined);assert.equal(panels.at(-1).disposed,true);view.dispose();
 }}finally{global.fetch=old;}
});
test('missing credentials avoid requests and failures remove stale financial data',async()=>{
 const old=global.fetch;let calls=0;global.fetch=async()=>{calls++;throw Error('offline');};
 let view=new BudgetView({...auth(),resolve:async()=>undefined},()=> 'https://api.example',()=>{});
 try{await view.show();assert.equal(calls,0);assert.match(panels.at(-1).webview.html,/Sign in/);view.dispose();view=new BudgetView(auth(),()=> 'https://api.example',()=>{});await view.show();assert.match(panels.at(-1).webview.html,/Could not load/);}finally{view.dispose();global.fetch=old;}
});
test('server authentication failure produces recovery text without popup loops',async()=>{
 const old=global.fetch;global.fetch=async()=>new Response('{}',{status:401});const view=new BudgetView(auth(),()=> 'https://api.example',()=>{});
 try{await view.show();assert.match(panels.at(-1).webview.html,/Renew Sign-in/);}finally{view.dispose();global.fetch=old;}
});
