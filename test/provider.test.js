const test=require('node:test');
const assert=require('node:assert/strict');
const Module=require('node:module');
const original=Module._load;
const status={show(){},hide(){},dispose(){}};
class Text {constructor(value){this.value=value;}}
class ToolCall {constructor(callId,name,input){Object.assign(this,{callId,name,input});}}
class ToolResult {}
class Data {}
let preferences={};
let origin='https://api.opper.ai';
const vs={EventEmitter:class{event=()=>({dispose(){}});fire(){}dispose(){}},StatusBarAlignment:{Right:1},window:{createStatusBarItem:()=>status,showInformationMessage(){}},workspace:{getConfiguration:()=>({get:(k,f)=>k==='baseUrl'?origin:k==='thinkingEffort'?preferences:f})},LanguageModelTextPart:Text,LanguageModelToolCallPart:ToolCall,LanguageModelToolResultPart:ToolResult,LanguageModelDataPart:Data,LanguageModelChatMessageRole:{User:1,Assistant:2},LanguageModelChatToolMode:{Required:2}};
Module._load=function(n,...args){return n==='vscode'?vs:original.call(this,n,...args)};
const {OpperChatModelProvider}=require('../out/provider.js');
Module._load=original;
const token={isCancellationRequested:false,onCancellationRequested:()=>({dispose(){}})};
const model={id:'test/model',maxInputTokens:6000,maxOutputTokens:2000};
const catalog={data:[{id:model.id,owned_by:'test',context_length:8000,opper:{type:'llm',kind:'model',max_output_tokens:2000,capabilities:['text','tools']}}]};
test('provider sends selected allowed model, bounds output and reads final streamed usage', async()=>{
 const old=global.fetch;let request;const parts=[];
 global.fetch=async(url,opts)=>{
  if(url.includes('/models'))return Response.json(catalog);
  request=JSON.parse(opts.body);
  return new Response('data: '+JSON.stringify({choices:[{delta:{content:'hello'},finish_reason:'stop'}]})+'\n\ndata: '+JSON.stringify({choices:[],usage:{prompt_tokens:1500}})+'\n\ndata: [DONE]\n\n');
 };
 const p=new OpperChatModelProvider({peekApiKey:async()=> 'synthetic',handleFailure:async()=>{}});
 try{
 await p.provideLanguageModelChatResponse(model,[{role:1,content:[new Text('Hi')]}],{modelOptions:{model:'wrong',max_tokens:999999,max_completion_tokens:999999},tools:[]},{report:part=>parts.push(part)},token);
 assert.equal(request.model,model.id);assert.equal(request.max_tokens,2000);assert.equal(request.max_completion_tokens,undefined);assert.equal(request.stream_options.include_usage,true);
 assert.match(status.tooltip,/Last request: 1,500/);assert.match(status.text,/25%/);assert.equal(parts[0].value,'hello');
 }finally{global.fetch=old;p.dispose();}
});
test('removed model never makes an inference request and credential errors offer recovery',async()=>{
 const old=global.fetch;let calls=0;let failure;
 global.fetch=async()=>{calls++;return Response.json({data:[]});};
 const p=new OpperChatModelProvider({peekApiKey:async()=> 'synthetic',handleFailure:async e=>{failure=e;}});
 try{await assert.rejects(p.provideLanguageModelChatResponse(model,[],{}, {report(){}},token),/no longer available/);assert.equal(calls,1);assert.match(failure.message,/no longer available/);}finally{global.fetch=old;p.dispose();}
});

test('discovery, saved effort and explicit option translate to captured wire request', async()=>{
 const old=global.fetch;const requests=[];
 const fixture={data:[{...catalog.data[0],opper:{...catalog.data[0].opper,reasoning:{supported:['low','medium','high','xhigh','max'],default:'medium'}}}]};
 global.fetch=async(url,opts)=>{if(url.includes('/models'))return Response.json(fixture);requests.push(JSON.parse(opts.body));return new Response('data: [DONE]\n\n');};
 preferences={'https://api.opper.ai':{[model.id]:'max'}};
 const p=new OpperChatModelProvider({peekApiKey:async()=> 'synthetic',handleFailure:async()=>{}});
 try{
  const [info]=await p.provideLanguageModelChatInformation({silent:true},token);
  assert.match(info.detail,/Effort: max/);
  await p.provideLanguageModelChatResponse(info,[],{modelOptions:{temperature:0.2}},{report(){}},token);
  assert.equal(requests[0].reasoning_effort,'max');assert.equal(requests[0].temperature,0.2);
  await p.provideLanguageModelChatResponse(info,[],{modelOptions:{reasoningEffort:'xhigh'}},{report(){}},token);
  assert.equal(requests[1].reasoning_effort,'xhigh');assert.equal(requests[1].reasoningEffort,undefined);
  await assert.rejects(p.provideLanguageModelChatResponse(info,[],{modelOptions:{reasoning_effort:'ultra'}},{report(){}},token),/unavailable/);
  assert.equal(requests.length,2);
  fixture.data[0].opper.reasoning.supported=['medium','high'];p.refresh();
  await assert.rejects(p.provideLanguageModelChatResponse(info,[],{},{report(){}},token),/Set Thinking Effort/);
  assert.equal(requests.length,2);
  preferences={};
  await p.provideLanguageModelChatResponse(info,[],{},{report(){}},token);
  assert.equal(requests[2].reasoning_effort,undefined);
 }finally{global.fetch=old;preferences={};p.dispose();}
});

test('endpoint change during discovery discards old models and their effort details', async()=>{
 const old=global.fetch;
 origin='https://a.example';
 preferences={'https://a.example':{[model.id]:'low'},'https://b.example':{[model.id]:'max'}};
 const p=new OpperChatModelProvider({peekApiKey:async()=> 'synthetic',handleFailure:async()=>{}});
 global.fetch=async()=>{origin='https://b.example';p.refresh();return Response.json(catalog);};
 try{
  const info=await p.provideLanguageModelChatInformation({silent:true},token);
  assert.deepEqual(info,[]);
 }finally{global.fetch=old;origin='https://api.opper.ai';preferences={};p.dispose();}
});

test('endpoint change during catalog loading blocks old inference; retry uses current endpoint preference', async()=>{
 const old=global.fetch;const requests=[];let changed=false;
 origin='https://a.example';
 preferences={'https://a.example':{[model.id]:'low'},'https://b.example':{[model.id]:'max'}};
 const fixture={data:[{...catalog.data[0],opper:{...catalog.data[0].opper,reasoning:{supported:['low','max'],default:'low'}}}]};
 const p=new OpperChatModelProvider({peekApiKey:async()=> 'synthetic',handleFailure:async()=>{}});
 global.fetch=async(url,opts)=>{
  if(url.includes('/models')){if(!changed){changed=true;origin='https://b.example';p.refresh();}return Response.json(fixture);}
  requests.push({url,body:JSON.parse(opts.body)});return new Response('data: [DONE]\n\n');
 };
 try{
  await assert.rejects(p.provideLanguageModelChatResponse(model,[],{},{report(){}},token),/endpoint changed/i);
  assert.equal(requests.length,0);
  await p.provideLanguageModelChatResponse(model,[],{},{report(){}},token);
  assert.equal(requests[0].url,'https://b.example/v3/compat/chat/completions');
  assert.equal(requests[0].body.reasoning_effort,'max');
 }finally{global.fetch=old;origin='https://api.opper.ai';preferences={};p.dispose();}
});

test('endpoint change while reading the credential never sends it to the new endpoint', async()=>{
 const old=global.fetch;let calls=0;
 global.fetch=async()=>{calls++;throw new Error('Unexpected request');};
 const p=new OpperChatModelProvider({peekApiKey:async()=>{origin='https://b.example';return 'synthetic';},handleFailure:async()=>{}});
 try{
  origin='https://a.example';
  assert.deepEqual(await p.provideLanguageModelChatInformation({silent:true},token),[]);
  origin='https://a.example';
  await assert.rejects(p.provideLanguageModelChatResponse(model,[],{},{report(){}},token),/endpoint changed/i);
  assert.equal(calls,0);
 }finally{global.fetch=old;origin='https://api.opper.ai';p.dispose();}
});
