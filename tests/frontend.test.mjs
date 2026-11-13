import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createFrontend} from './frontend-harness.mjs';
function result(prompt){
 if(prompt.includes('ЗАДАЧА: разбери структуру'))return {blocks:[],key_message:'Зарплатный проект',confidence:90};
 if(prompt.includes('ЗАДАЧА: сверь выступление'))return {claims:[],missed:[],confidence:90};
 if(prompt.includes('ЗАДАЧА: оцени выступление'))return {criteria:[],strengths:[],weaknesses:[],confidence:90};
 if(prompt.includes('ЗАДАЧА: ты — независимый'))return {issues:[],missed_claims:[],confidence:{structure:96,facts:96,rubric:96},overall:96};
 return {summary:'Тестовый итог',top_strengths:[],growth:[],rewrites:[],exercise:'Повторить вступление'};
}
test('all seven pipeline stages complete and a report is saved',async()=>{
 let calls=0;const f=createFrontend(async(path,options)=>{if(path==='/api/status')return Response.json({authorized:true,configured:true});calls++;const input=JSON.parse(options.body);assert.equal(input.jsonMode,true);return Response.json({choices:[{message:{content:JSON.stringify(result(input.prompt))}}]});});
 await f.runAuto();
 assert.equal(calls,5);assert.ok(f.App.cur.report);assert.equal(f.App.cur.report.provider,'DeepSeek');assert.equal(f.App.cur.status,'analyzed');assert.equal(f.App.running,false);
 for(const value of Object.values(f.stepState))assert.equal(value.status,'done');
 assert.match(f.node('report').innerHTML,/Тестовый итог/);
});
test('authentication failure is clear and prevents model requests',async()=>{
 let calls=0;const f=createFrontend(async()=>{calls++;return Response.json({authorized:false,configured:true});});await f.runAuto();assert.equal(calls,1);assert.equal(f.App.cur.report,null);assert.match(f.node('runNote').textContent,/пароль/);assert.equal(f.App.running,false);
});
test('parallel stage failure settles other jobs and keeps successful stages for retry',async()=>{
 let failed=true,structureCalls=0;const f=createFrontend(async(path,options)=>{if(path==='/api/status')return Response.json({authorized:true,configured:true});const input=JSON.parse(options.body);if(input.prompt.includes('ЗАДАЧА: разбери структуру'))structureCalls++;if(failed&&input.prompt.includes('ЗАДАЧА: сверь выступление'))return Response.json({code:'balance',message:'Недостаточно средств'},{status:502});return Response.json({choices:[{message:{content:JSON.stringify(result(input.prompt))}}]});});
 await f.runAuto();assert.equal(f.stepState.facts.status,'err');assert.equal(f.stepState.structure.status,'done');assert.match(f.node('runNote').textContent,/Недостаточно средств/);failed=false;await f.runAuto();assert.ok(f.App.cur.report);assert.equal(structureCalls,1);
});
test('transcription always uses Whisper, irrespective of legacy settings',async()=>{
 const f=createFrontend(()=>{throw Error('Whisper must not call the LLM API');});let calls=0;f.Whisper.run=async()=>calls++;f.App.settings.sttEngine='gigachat';await f.startTranscription();assert.equal(calls,1);
});

test('Whisper saves completed chunks when later recognition is cancelled',async()=>{
 const f=createFrontend(()=>{throw Error('Audio must never go to an API');});
 f.App.cur.transcript='';f.App.cur.hasAudio=true;let chunks=0;const saved=[];
 f.configureSpeechTest({decode:async()=>new Float32Array(32000).fill(0.1),split:()=>[{start:0,end:16000},{start:16000,end:32000}],get:async()=>({blob:new Blob(['audio'])}),put:async(k,s)=>saved.push(structuredClone(s))});
 f.Whisper.device=async()=> 'wasm';f.Whisper.call=async request=>{if(request.type==='load')return {};if(++chunks===2)throw {code:'cancelled'};return {text:'Добрый день, коллеги.'};};
 await f.Whisper.run();assert.match(f.App.cur.transcript,/Добрый день/);assert.equal(f.App.cur.transcriptSource,'whisper');assert.equal(saved.length,1);assert.equal(f.Whisper.busy,false);assert.equal(f.node('transcript').readOnly,false);
});
