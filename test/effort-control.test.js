const test=require('node:test');
const assert=require('node:assert/strict');
const Module=require('node:module');
const original=Module._load;
let stored={}, picks=[], seen=[], writes=0, origin='https://fixture';
const vs={ConfigurationTarget:{Global:1},workspace:{getConfiguration:()=>({get:(key,fallback)=>key==='thinkingEffort'?stored:key==='baseUrl'?origin:fallback,update:async(key,value)=>{stored=value;writes++;}})},window:{showInformationMessage(){},showQuickPick:async(items)=>{seen.push(items);return picks.shift()?.(items);}}};
Module._load=function(n,...args){return n==='vscode'?vs:original.call(this,n,...args)};
const {savedEffort,chooseEffort}=require('../out/effort-control.js');
Module._load=original;
const entry={id:'gpt-6.1-sol',opper:{kind:'pool',reasoning:{supported:['medium','high','max'],default:'medium'}}};
test('malformed settings cannot blank discovery or poison endpoint/id lookup',()=>{
 for(const value of [null, [], 'bad', {'https://fixture':null}, {'https://fixture':[]}, {'https://fixture':{[entry.id]:3}}]){stored=value;assert.equal(savedEffort(origin,entry.id),undefined);}
 stored={'https://fixture':{[entry.id]:'max'}};
 assert.equal(savedEffort(origin+'/',entry.id),'max');assert.equal(savedEffort('https://other',entry.id),undefined);
});
test('command selects exact metadata level, preserves other scopes and resets to server default',async()=>{
 stored={'https://other':{another:'low'}};seen=[];writes=0;
 picks=[items=>items[0],items=>items.find(i=>i.value==='max')];
 await chooseEffort([entry],origin);
 assert.equal(savedEffort(origin,entry.id),'max');assert.deepEqual(seen[1].map(i=>i.value),[undefined,'medium','high','max']);
 assert.equal(stored['https://other'].another,'low');
 picks=[items=>items[0],items=>items[0]];await chooseEffort([entry],origin);
 assert.equal(savedEffort(origin,entry.id),undefined);assert.equal(writes,2);
});
test('dismissal writes nothing and stale effort remains resettable',async()=>{
 stored={'https://fixture':{[entry.id]:'max'}};writes=0;
 picks=[];await chooseEffort([entry],origin);assert.equal(writes,0);
 picks=[items=>items[0],items=>items[0]];
 await chooseEffort([{...entry,opper:{kind:'model'}}],origin);
 assert.equal(savedEffort(origin,entry.id),undefined);
});
test('origin changes during selection abort before saving',async()=>{
 stored={};writes=0;origin='https://fixture';
 picks=[items=>items[0],items=>{origin='https://other';return items[1]}];
 await assert.rejects(chooseEffort([entry],'https://fixture'),/endpoint changed/i);assert.equal(writes,0);
 origin='https://fixture';
});
