const test=require('node:test');
const assert=require('node:assert/strict');
const Module=require('node:module');
const original=Module._load;
let onAuth,onConfig,picks=[],infos=[],warnings=[],choices=[],onPick;
const disposable={dispose(){}};
const vs={CancellationTokenSource:class {token={isCancellationRequested:false};cancel(){this.token.isCancellationRequested=true;}dispose(){}},workspace:{onDidChangeConfiguration(fn){onConfig=fn;return disposable;}},window:{async showQuickPick(items,opts,token){picks.push({items,opts,token});if(onPick)await onPick();return choices.shift()==='refresh'?items.find(i=>i.action==='refresh'):undefined;},async showInformationMessage(m){infos.push(m);},async showWarningMessage(m){warnings.push(m);}}};
Module._load=function(n,...args){return n==='vscode'?vs:original.call(this,n,...args);};
const {showBudget}=require('../out/budget-view.js');
Module._load=original;
function reset(){picks=[];infos=[];warnings=[];choices=[];onPick=undefined;}
function auth(){return {resolve:async()=>({key:'synthetic'}),onDidChange(fn){onAuth=fn;return disposable;},handleFailure:async()=>{}};}
test('budget command fetches only /me and refreshes without retaining old values',async()=>{
 reset();const old=global.fetch;let calls=0;choices=['refresh'];
 global.fetch=async url=>{assert.equal(url,'https://api.example/v3/me');return Response.json({project:{name:'dev'},project_spend:{currency:'usd',spent_cents:++calls*100,limit_cents:null}});};
 try {await showBudget(auth(),()=> 'https://api.example');assert.equal(calls,2);assert.match(JSON.stringify(picks[0]),/USD 1.00/);assert.match(JSON.stringify(picks[1]),/USD 2.00/);}finally{global.fetch=old;}
});
test('credential or origin changes during a request discard its result',async()=>{
 const old=global.fetch;
 try{for(const change of [()=>onAuth(),()=>onConfig({affectsConfiguration:()=>true})]){
  reset();global.fetch=async()=>{change();return Response.json({balance:{balance_cents:999999}});};
  await showBudget(auth(),()=> 'https://api.example');assert.equal(picks.length,0);assert.equal(warnings.length,0);
 }}finally{global.fetch=old;}
});
test('credential changes while the budget is displayed cancel that view',async()=>{
 reset();const old=global.fetch;global.fetch=async()=>Response.json({});onPick=async()=>onAuth();
 try{await showBudget(auth(),()=> 'https://api.example');assert.equal(picks[0].token.isCancellationRequested,true);}finally{global.fetch=old;}
});
test('missing credentials make no request; failed requests show no stale budget',async()=>{
 reset();const old=global.fetch;let calls=0;global.fetch=async()=>{calls++;throw Error('offline');};
 try{await showBudget({...auth(),resolve:async()=>undefined},()=> 'https://api.example');assert.equal(calls,0);assert.match(infos[0],/Sign in/);
 await showBudget(auth(),()=> 'https://api.example');assert.equal(picks.length,0);assert.match(warnings[0],/Could not load/);
 }finally{global.fetch=old;}
});
test('expired credentials use existing recovery; legacy spending blocks explain unavailable details',async()=>{
 reset();const old=global.fetch;let recovered=false;
 try{global.fetch=async()=>new Response('{}',{status:401});await showBudget({...auth(),handleFailure:async()=>{recovered=true;}},()=> 'https://api.example');assert.equal(recovered,true);
 global.fetch=async()=>new Response('{}',{status:402});await showBudget(auth(),()=> 'https://api.example');assert.match(warnings[0],/Spending is blocked/);assert.equal(picks.length,0);
 }finally{global.fetch=old;}
});
