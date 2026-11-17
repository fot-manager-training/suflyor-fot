import {test} from 'node:test';
import {spawn} from 'node:child_process';
import {mkdtempSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import {createAppServer} from '../server/node.mjs';
test('Timeweb server works without an application password or login session',async()=>{
 const server=createAppServer({DEEPSEEK_API_KEY:'unused'});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 try{
  const root=await fetch(base);assert.equal(root.status,200);assert.match(await root.text(),/Whisper/);assert.equal(root.headers.get('set-cookie'),null);
  const s=await fetch(base+'/api/status').then(r=>r.json());assert.equal(s.version,'2.1.0');assert.equal(s.knowledgeVersion,'2026-11-17.2.1');assert.equal(s.authorized,true);assert.equal(s.speech,'whisper');assert.equal(s.login_url,null);assert.equal(s.configured,true);assert.equal(JSON.stringify(s).includes('unused'),false);
  const login=await fetch(base+'/login',{redirect:'manual'});assert.equal(login.status,303);assert.equal(login.headers.get('location'),'/#new');assert.equal(login.headers.get('set-cookie'),null);
  const invalid=await fetch(base+'/api/analyze',{method:'POST',body:'{}',headers:{'Content-Type':'application/json'}});assert.equal(invalid.status,400);assert.equal((await invalid.json()).code,'invalid_input');
  const foreign=await fetch(base+'/api/analyze',{method:'POST',body:'{}',headers:{'Content-Type':'application/json',Origin:'https://untrusted.example','oai-authenticated-user-id':'owner'}});assert.equal(foreign.status,403);
  assert.equal((await fetch(base+'/.env')).status,404);
  assert.deepEqual(await fetch(base+'/healthz').then(r=>r.json()),{status:'ok'});
 }finally{await new Promise(resolve=>server.close(resolve));}
});

test('CLI starts the HTTP listener when launched through the VPS current symlink',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'suflyor-launch-'));
 symlinkSync(resolve('.'),join(directory,'current'),'dir');
 const child=spawn(process.execPath,[join(directory,'current/server/node.mjs')],{env:{...process.env,DEEPSEEK_API_KEY:'unused',HOST:'127.0.0.1',PORT:'0'},stdio:['ignore','pipe','pipe']});
 const exited=once(child,'exit');let diagnostic='';child.stderr.on('data',data=>diagnostic+=data);
 let timeout;
 try{
  const address=await Promise.race([
   new Promise(resolve=>{let text='';child.stdout.on('data',data=>{text+=data;const match=text.match(/listening on port (\d+)/);if(match)resolve('http://127.0.0.1:'+match[1]);});}),
   exited.then(([code])=>{throw new Error('CLI exited before listening: '+code+' '+diagnostic);}),
   new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('CLI did not listen: '+diagnostic)),10000);})
  ]);
  assert.deepEqual(await fetch(address+'/healthz').then(r=>r.json()),{status:'ok'});
 }finally{clearTimeout(timeout);child.kill();await exited;rmSync(directory,{recursive:true,force:true});}
});
