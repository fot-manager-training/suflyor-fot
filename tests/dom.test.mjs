import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM,VirtualConsole} from 'jsdom';
import {IDBFactory} from 'fake-indexeddb';
const html=readFileSync(new URL('../suflyor/index.html',import.meta.url),'utf8');
const script=readFileSync(new URL('../suflyor/app.js',import.meta.url),'utf8');
async function until(predicate){for(let i=0;i<100;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,10));}throw Error('Page did not reach the expected state');}
async function setup({microphone=true}={}){
 const errors=[];const console=new VirtualConsole();console.on('jsdomError',error=>errors.push(error.message));
 const dom=new JSDOM(html,{url:'https://example.test/#new',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:console});
 const w=dom.window;
 Object.defineProperty(w,'indexedDB',{value:new IDBFactory()});
 w.structuredClone=structuredClone;w.Blob=Blob;w.File=File;
 w.fetch=async()=>Response.json({authorized:true,configured:true,login_url:'/login'});w.scrollTo=()=>{};
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
 w.eval(script+'\nwindow.__appTest={App,Store,Rec,Whisper};');
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
