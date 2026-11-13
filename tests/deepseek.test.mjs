import {test} from 'node:test';
import assert from 'node:assert/strict';
import {handleApi} from '../worker/index.mjs';
const env={SITE_OWNER_ID:'owner',DEEPSEEK_API_KEY:'server-key',DEEPSEEK_MODEL:'deepseek-flash'};
const request=(body,headers={})=>new Request('https://example.test/api/analyze',{method:'POST',headers:{origin:'https://example.test','oai-authenticated-user-id':'owner',...headers},body:JSON.stringify(body)});
test('owner-only access, CSRF protection and safe upstream error messages',async()=>{
 let calls=0;globalThis.fetch=async()=>{calls++;return new Response('secret upstream body',{status:401});};
 assert.equal((await handleApi(request({prompt:'test'},{'oai-authenticated-user-id':''}),env)).status,401);
 assert.equal((await handleApi(request({prompt:'test'},{'oai-authenticated-user-id':'other'}),env)).status,403);
 assert.equal((await handleApi(request({prompt:'test'},{origin:'https://evil.test'}),env)).status,403);
 assert.equal(calls,0);
 const response=await handleApi(request({prompt:'test'}),env);assert.equal(response.status,502);assert.equal((await response.text()).includes('secret upstream body'),false);
});
test('DeepSeek JSON mode, model and secret remain server-side',async()=>{
 globalThis.fetch=async(url,options)=>{assert.equal(url,'https://api.deepseek.com/chat/completions');assert.equal(options.headers.Authorization,'Bearer server-key');const b=JSON.parse(options.body);assert.equal(b.model,'deepseek-flash');assert.equal(b.thinking.type,'disabled');assert.equal(b.response_format.type,'json_object');return Response.json({model:b.model,choices:[{finish_reason:'stop',message:{content:'{"ok":true}'}}]});};
 const r=await handleApi(request({prompt:'Return JSON',jsonMode:true}),env);assert.equal(r.status,200);const data=await r.json();assert.equal(data.choices[0].message.content,'{"ok":true}');assert.equal(JSON.stringify(data).includes('server-key'),false);
});
test('invalid JSON, truncated and empty replies are failures, not completed stages',async()=>{
 for(const [choice,code] of [[{message:{content:'not json'}},'invalid_json'],[{message:{content:'{}'},finish_reason:'length'},'too_large'],[{message:{content:'   '}},'empty']]){
  globalThis.fetch=async()=>Response.json({choices:[choice]});const r=await handleApi(request({prompt:'JSON',jsonMode:true}),env);assert.equal(r.status,502);assert.equal((await r.json()).code,code);
 }
});
test('API balance and upstream rate limits have actionable errors',async()=>{
 for(const [status,code,out] of [[402,'balance',502],[429,'rate_limited',429],[503,'overloaded',503]]){
  globalThis.fetch=async()=>new Response('',{status});const r=await handleApi(request({prompt:'test'}),env);assert.equal(r.status,out);assert.equal((await r.json()).code,code);
 }
});
test('portable mode ignores spoofed ChatGPT identity and accepts only server session context',async()=>{
 const e={...env,AUTH_MODE:'password'};
 const r=await handleApi(request({prompt:'test'}),e);assert.equal(r.status,401);
 const s=await handleApi(new Request('https://example.test/api/status'),{...e,REQUEST_USER_ID:'owner'});assert.equal((await s.json()).authorized,true);
});
