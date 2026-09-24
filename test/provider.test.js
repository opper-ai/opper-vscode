const test=require('node:test');
const assert=require('node:assert/strict');
const Module=require('node:module');
const original=Module._load;
const status={show(){},hide(){},dispose(){}};
class Text {constructor(value){this.value=value;}}
class ToolCall {constructor(callId,name,input){Object.assign(this,{callId,name,input});}}
class ToolResult {}
class Data {}
const vs={EventEmitter:class{event=()=>({dispose(){}});fire(){}dispose(){}},StatusBarAlignment:{Right:1},window:{createStatusBarItem:()=>status,showInformationMessage(){}},workspace:{getConfiguration:()=>({get:(_k,f)=>f})},LanguageModelTextPart:Text,LanguageModelToolCallPart:ToolCall,LanguageModelToolResultPart:ToolResult,LanguageModelDataPart:Data,LanguageModelChatMessageRole:{User:1,Assistant:2},LanguageModelChatToolMode:{Required:2}};
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
 assert.match(status.tooltip,/Server-reported input: 1,500/);assert.match(status.text,/25%/);assert.equal(parts[0].value,'hello');
 }finally{global.fetch=old;p.dispose();}
});
test('removed model never makes an inference request and credential errors offer recovery',async()=>{
 const old=global.fetch;let calls=0;let failure;
 global.fetch=async()=>{calls++;return Response.json({data:[]});};
 const p=new OpperChatModelProvider({peekApiKey:async()=> 'synthetic',handleFailure:async e=>{failure=e;}});
 try{await assert.rejects(p.provideLanguageModelChatResponse(model,[],{}, {report(){}},token),/no longer available/);assert.equal(calls,1);assert.match(failure.message,/no longer available/);}finally{global.fetch=old;p.dispose();}
});
