import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
export function createFrontend(fetchImpl){
 const nodes=new Map();
 const node=id=>{
  if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',innerHTML:'',dataset:{},style:{},classList:{add(){},remove(){},toggle(){},contains(){return false;}},addEventListener(){},removeEventListener(){},setAttribute(){},getAttribute(){return ''},querySelector(){return node(id+'-child');},querySelectorAll(){return []},append(){},focus(){}});
  return nodes.get(id);
 };
 let source=readFileSync(new URL('../suflyor/app.js',import.meta.url),'utf8');
 source=source.slice(0,source.indexOf('/* =========================== СТАРТ'));
 const context={document:{getElementById:node,querySelectorAll:()=>[],querySelector:()=>node('query'),createElement:()=>node('created')},window:{addEventListener(){},scrollTo(){}},navigator:{},location:{hash:'#new',href:'https://example.test/#new'},history:{replaceState(){}},fetch:fetchImpl,setTimeout,clearTimeout,setInterval,clearInterval,AbortController,Blob,URL,crypto:globalThis.crypto,console,structuredClone};
 const api=runInNewContext(source+`\nStore.put=async()=>{}; Store.kv=async()=>{}; Store.all=async()=>[];\n({configureSpeechTest:options=>{decodeTo16k=options.decode;splitChunks=options.split;Store.get=options.get;Store.put=options.put;},App,Whisper,runAuto,resetSteps,stepState,newSession,DEMO,parseTranscript,computeMetrics,CRITERIA,startTranscription,pStructure,pFacts,pRubric,pVerify,pRevise,pFinal,quoteCheck,normFindings,computeScores,parseJSONLoose});`,context);
 api.App.cur=api.newSession();api.App.cur.transcript=api.DEMO;
 node('transcript').value=api.DEMO;node('duration').value='2:10';node('manager').value='Тест';node('audience').value='КСБ';node('format').value='Встреча';node('goal').value='Договориться о следующем шаге';
 api.App.settings.maxIter=1;
 api.resetSteps();
 return {...api,node};
}
