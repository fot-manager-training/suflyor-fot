import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM,VirtualConsole} from 'jsdom';
import {IDBFactory} from 'fake-indexeddb';
import {extractDocument} from '../suflyor/document-reader.mjs';
const html=readFileSync(new URL('../suflyor/index.html',import.meta.url),'utf8');
const script=readFileSync(new URL('../suflyor/app.js',import.meta.url),'utf8');
async function until(predicate){for(let i=0;i<100;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,10));}throw Error('Page did not reach the expected state');}
async function setup({microphone=true}={}){
 const errors=[];const console=new VirtualConsole();console.on('jsdomError',error=>errors.push(error.message));
 const dom=new JSDOM(html,{url:'https://example.test/#new',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:console});
 const w=dom.window;
 Object.defineProperty(w,'indexedDB',{value:new IDBFactory()});
 w.structuredClone=structuredClone;w.Blob=Blob;w.File=File;
 w.fetch=async path=>path==='/knowledge.json'?Response.json(JSON.parse(readFileSync(new URL('../suflyor/knowledge.json',import.meta.url),'utf8'))):Response.json({authorized:true,configured:true,login_url:null});w.SuflyorDocs={extractDocument};w.scrollTo=()=>{};
 w.URL.createObjectURL=URL.createObjectURL;w.URL.revokeObjectURL=URL.revokeObjectURL;
 let micRequests=0,stoppedTracks=0;
 if(microphone){
  Object.defineProperty(w.navigator,'mediaDevices',{value:{getUserMedia:async()=>{micRequests++;return {getTracks:()=>[{stop(){stoppedTracks++;}}]};}}});
  w.MediaRecorder=class{
   static isTypeSupported(){return true;}
   constructor(){this.state='inactive';this.mimeType='audio/webm';}
   start(){this.state='recording';}pause(){this.state='paused';}resume(){this.state='recording';}
   stop(){this.state='inactive';this.ondataavailable?.({data:new Blob(['recorded audio'],{type:this.mimeType})});this.onstop?.();}
  };
 }
 w.eval(script+'\nwindow.__appTest={App,Store,Rec,Whisper,Knowledge,syncWorkflow};');
 await until(()=>w.__appTest.App.cur);
 let speechRuns=0;w.__appTest.Whisper.run=async()=>{speechRuns++;};
 return {dom,w,api:w.__appTest,errors,get speechRuns(){return speechRuns;},get micRequests(){return micRequests;},get stoppedTracks(){return stoppedTracks;},close(){if(w.__appTest.App.audioUrl)URL.revokeObjectURL(w.__appTest.App.audioUrl);dom.window.close();}};
}
test('complete real HTML and script start with all seven pipeline stages and navigation',async()=>{
 const t=await setup();try{
  assert.equal(t.errors.length,0);assert.equal(t.w.document.querySelectorAll('#steps > li').length,7);
  assert.equal(t.w.document.querySelector('#view-work').classList.contains('hidden'),false);
  t.w.location.hash='#settings';await until(()=>!t.w.document.querySelector('#view-settings').classList.contains('hidden'));
  assert.equal(t.w.document.querySelector('#provider').value,'deepseek');
 }finally{t.close();}
});
test('file input stores actual audio, displays player and starts Whisper',async()=>{
 const t=await setup();try{
  t.w.document.querySelector('[data-src="upload"]').click();
  const file=new File(['uploaded audio'],'sample.wav',{type:'audio/wav'});
  const input=t.w.document.getElementById('audioIn');Object.defineProperty(input,'files',{value:[file],configurable:true});input.dispatchEvent(new t.w.Event('change'));
  await until(()=>t.speechRuns===1);
  assert.equal(t.api.App.cur.hasAudio,true);assert.equal(t.api.App.cur.source,'upload');
  assert.equal(t.w.document.getElementById('audioBox').classList.contains('hidden'),false);
  assert.match(t.w.document.getElementById('player').src,/^blob:/);
  const stored=await t.api.Store.get('audio',t.api.App.cur.id);assert.equal(await stored.blob.text(),'uploaded audio');
  assert.equal(t.w.document.querySelectorAll('#steps > li').length,7);assert.deepEqual(t.errors,[]);
 }finally{t.close();}
});
test('record button requests microphone, saves recorded audio and starts Whisper after stop',async()=>{
 const t=await setup();try{
  const button=t.w.document.getElementById('recBtn');assert.equal(button.disabled,false);button.click();await until(()=>t.api.Rec.active);
  assert.equal(t.micRequests,1);button.click();await until(()=>t.speechRuns===1);
  assert.equal(t.api.Rec.active,false);assert.equal(t.api.App.cur.hasAudio,true);assert.equal(t.stoppedTracks,1);
  assert.equal(t.w.document.getElementById('audioBox').classList.contains('hidden'),false);
  const stored=await t.api.Store.get('audio',t.api.App.cur.id);assert.equal(await stored.blob.text(),'recorded audio');assert.deepEqual(t.errors,[]);
 }finally{t.close();}
});
test('missing microphone support does not prevent startup, file upload or pipeline display',async()=>{
 const t=await setup({microphone:false});try{
  assert.equal(t.w.document.getElementById('recBtn').disabled,true);assert.equal(t.w.document.querySelectorAll('#steps > li').length,7);
  const input=t.w.document.getElementById('audioIn');Object.defineProperty(input,'files',{value:[new File(['audio'],'file.mp3',{type:'audio/mpeg'})]});input.dispatchEvent(new t.w.Event('change'));await until(()=>t.speechRuns===1);assert.equal(t.api.App.cur.hasAudio,true);
 }finally{t.close();}
});

test('Sites startup does not display a ChatGPT login prompt',async()=>{
 const t=await setup();try{
  t.w.fetch=async()=>Response.json({authorized:true,configured:true,login_url:null});
  assert.equal(t.w.document.querySelector('a[href*="signin-with-chatgpt"]'),null);
  assert.equal(t.w.document.querySelector('#appSignin').classList.contains('hidden'),true);
 }finally{t.close();}
});

test('recording modes are absent and microphone controls remain available',async()=>{
 const t=await setup();try{assert.equal(t.w.document.getElementById('recMode'),null);assert.equal(t.w.document.querySelector('label[for="recMode"]'),null);assert.equal(t.w.document.getElementById('recBtn').disabled,false);}finally{t.close();}
});
test('Word upload reads the document and unlocks context for a sufficiently long transcript',async()=>{
 const t=await setup();try{
  t.w.document.querySelector('[data-src="text"]').click();
  const bytes=readFileSync(new URL('./fixtures/meeting.docx',import.meta.url));
  const input=t.w.document.getElementById('textIn');Object.defineProperty(input,'files',{value:[new File([bytes],'meeting.docx')],configurable:true});input.dispatchEvent(new t.w.Event('change'));
  await until(()=>t.api.App.cur.transcript.includes('Следующий шаг'));
  await until(()=>!t.api.App.task);
  assert.match(t.w.document.getElementById('transcript').value,/Добрый день/);assert.equal(t.api.App.cur.transcriptSource,'file');
  assert.match(t.w.document.getElementById('textImportNote').textContent,/Загружен/);
  assert.equal(t.w.document.getElementById('runBtn').disabled,true);
  t.w.document.getElementById('transcript').value=('Достаточно длинный текст о зарплатном проекте для проверки контекста. ').repeat(10);
  t.w.document.getElementById('transcript').dispatchEvent(new t.w.Event('input'));
  assert.equal(t.w.document.getElementById('runBtn').disabled,false);assert.equal(t.w.document.getElementById('contextCard').classList.contains('is-active'),true);
 }finally{t.close();}
});
test('knowledge documents are merged and a person can append and save a new item',async()=>{
 const t=await setup();try{
  assert.equal(t.api.Knowledge.sources.length,3);assert.match(t.api.App.kbSp,/ИСТОЧНИК: reference-speech/);assert.match(t.api.App.kbZp,/ИСТОЧНИК: salary-project/);
  t.w.location.hash='#kb';await until(()=>t.w.document.getElementById('kbZp').value.includes('ИСТОЧНИК'));
  t.w.document.getElementById('kbItemTitle').value='Новое правило';t.w.document.getElementById('kbItemText').value='Уточняйте вопрос клиента перед ответом.';t.w.document.getElementById('kbAddItem').click();
  await until(()=>t.w.document.getElementById('kbItemNote').textContent.includes('сохранён'));
  const stored=await t.api.Store.kv('kb');assert.match(stored.zp,/Новое правило/);assert.match(stored.zp,/Уточняйте вопрос/);assert.ok(stored.bundleVersion);
 }finally{t.close();}
});
test('active recording and transcription lock incompatible stages and navigation',async()=>{
 const t=await setup();try{
  t.w.document.getElementById('recBtn').click();await until(()=>t.api.Rec.active);
  assert.equal(t.w.document.getElementById('audioIn').disabled,true);assert.equal(t.w.document.getElementById('textIn').disabled,true);assert.equal(t.w.document.getElementById('runBtn').disabled,true);assert.equal(t.w.document.getElementById('recBtn').disabled,false);
  assert.equal(t.w.document.getElementById('sourceCard').classList.contains('is-active'),true);
  t.w.document.getElementById('recBtn').click();await until(()=>t.speechRuns===1);
  t.api.Whisper.busy=true;t.api.syncWorkflow();
  assert.equal(t.w.document.getElementById('transcriptCard').classList.contains('is-active'),true);assert.equal(t.w.document.getElementById('transcript').readOnly,true);assert.equal(t.w.document.getElementById('goal').disabled,true);
  assert.equal(t.w.document.getElementById('whisperStop').disabled,false);assert.equal(t.w.document.querySelector('.topbar nav a').getAttribute('aria-disabled'),'true');
  t.api.Whisper.busy=false;t.api.syncWorkflow();assert.equal(t.w.document.getElementById('audioIn').disabled,false);
 }finally{t.api.Whisper.busy=false;t.close();}
});

test('failed document import preserves the current transcript and unlocks controls',async()=>{
 const t=await setup();try{
  t.w.document.querySelector('[data-src="text"]').click();const area=t.w.document.getElementById('transcript');area.value='Сохранённый текст встречи';area.dispatchEvent(new t.w.Event('input'));const id=t.api.App.cur.id;
  const input=t.w.document.getElementById('textIn');Object.defineProperty(input,'files',{value:[new File(['broken pdf'],'bad.pdf')],configurable:true});input.dispatchEvent(new t.w.Event('change'));
  await until(()=>t.w.document.getElementById('textImportNote').textContent.includes('Не удалось'));
  assert.equal(t.api.App.cur.id,id);assert.equal(t.api.App.cur.transcript,'Сохранённый текст встречи');assert.equal(input.disabled,false);assert.equal(t.api.App.task,null);
 }finally{t.close();}
});
