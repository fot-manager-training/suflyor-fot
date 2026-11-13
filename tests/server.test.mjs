import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAppServer} from '../server/node.mjs';
test('Timeweb server serves app and password login without trusting public identity headers',async()=>{
 const server=createAppServer({DEEPSEEK_API_KEY:'unused',APP_PASSWORD:'test-password',APP_SESSION_SECRET:'test-secret'});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 try{
  const root=await fetch(base);assert.equal(root.status,200);assert.match(await root.text(),/Whisper/);
  let s=await fetch(base+'/api/status',{headers:{'oai-authenticated-user-id':'owner'}}).then(r=>r.json());assert.equal(s.authorized,false);assert.equal(s.speech,'whisper');assert.equal(s.login_url,'/login');
  const bad=await fetch(base+'/login',{method:'POST',body:'password=wrong',headers:{'Content-Type':'application/x-www-form-urlencoded'}});assert.equal(bad.status,401);
  const login=await fetch(base+'/login',{method:'POST',body:'password=test-password',redirect:'manual',headers:{'Content-Type':'application/x-www-form-urlencoded'}});assert.equal(login.status,303);
  const cookie=login.headers.get('set-cookie').split(';')[0];assert.match(login.headers.get('set-cookie'),/HttpOnly/);
  s=await fetch(base+'/api/status',{headers:{cookie}}).then(r=>r.json());assert.equal(s.authorized,true);
  s=await fetch(base+'/api/status',{headers:{cookie:cookie+'tampered'}}).then(r=>r.json());assert.equal(s.authorized,false);
  assert.equal((await fetch(base+'/.env')).status,404);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
