import http from 'node:http';
import {createHash,createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import worker from '../dist/server/index.js';
const hash=value=>createHash('sha256').update(value).digest();
const equal=(a,b)=>timingSafeEqual(hash(a),hash(b));
const loginHtml=(error='')=>`<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Вход · Суфлёр</title><style>body{font:16px system-ui;background:#eef1f4;color:#17202b;max-width:380px;margin:10vh auto;padding:24px}form{background:white;padding:24px;border-radius:12px;display:grid;gap:16px}input,button{font:inherit;padding:12px;border:1px solid #d7dde4;border-radius:8px}button{background:#b25e09;color:white;cursor:pointer}.error{color:#b42318}</style><form method="post" action="/login"><h1>Суфлёр</h1><label for="password">Пароль приложения</label><input id="password" name="password" type="password" required autocomplete="current-password" autofocus><button>Войти</button><p class="error">${error}</p></form></html>`;
export function createAppServer(settings=process.env){
  if(!settings.DEEPSEEK_API_KEY)throw new Error('Set DEEPSEEK_API_KEY in the server environment.');
  if(!settings.APP_PASSWORD)throw new Error('Set APP_PASSWORD in the server environment.');
  const env={DEEPSEEK_API_KEY:settings.DEEPSEEK_API_KEY,DEEPSEEK_MODEL:settings.DEEPSEEK_MODEL||'deepseek-flash',AUTH_MODE:'password',SITE_OWNER_ID:'owner'};
  const secret=settings.APP_SESSION_SECRET||randomBytes(32).toString('hex');
  const sign=payload=>createHmac('sha256',secret).update(payload).digest('base64url');
  const attempts=new Map();
  function sessionValid(cookie=''){
    const value=cookie.split(';').map(x=>x.trim()).find(x=>x.startsWith('suflyor_session='))?.slice(16);
    if(!value)return false;
    const [payload,signature]=value.split('.');
    if(!payload||!signature||!equal(sign(payload),signature))return false;
    try{const decoded=JSON.parse(Buffer.from(payload,'base64url').toString());return decoded.expires>Date.now()&&decoded.user==='owner';}catch{return false;}
  }
  return http.createServer(async(req,res)=>{
    const abort=new AbortController();
    res.on('close',()=>{if(!res.writableEnded)abort.abort();});
    try{
      const protocol=settings.NODE_ENV==='production'?'https':'http';
      const origin=`${protocol}://${req.headers.host||'localhost'}`;
      const url=new URL(req.url,origin);
      if(url.pathname==='/healthz'){res.writeHead(200,{'Content-Type':'application/json'});res.end('{"status":"ok"}');return;}
      let body;
      if(!['GET','HEAD'].includes(req.method)){
        const chunks=[];let size=0;
        for await(const chunk of req){size+=chunk.length;if(size>1024*1024){res.writeHead(413);res.end('Request too large');return;}chunks.push(chunk);}
        body=Buffer.concat(chunks);
      }
      if(url.pathname==='/login'){
        if(!['GET','POST'].includes(req.method)){res.writeHead(405);res.end();return;}
        if(req.method==='GET'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(loginHtml());return;}
        if(req.headers.origin&&req.headers.origin!==origin){res.writeHead(403);res.end('Forbidden');return;}
        const ip=req.socket.remoteAddress,now=Date.now();
        for(const [k,v] of attempts)if(v.until<now)attempts.delete(k);
        const attempt=attempts.get(ip)||{count:0,until:now+15*60000};
        if(++attempt.count>15){res.writeHead(429);res.end('Retry in 15 minutes');return;}
        attempts.set(ip,attempt);
        const password=new URLSearchParams(body?.toString()).get('password')||'';
        if(!equal(password,settings.APP_PASSWORD)){res.writeHead(401,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(loginHtml('Неверный пароль.'));return;}
        attempts.delete(ip);
        const payload=Buffer.from(JSON.stringify({user:'owner',expires:Date.now()+7*86400000,nonce:randomBytes(16).toString('hex')})).toString('base64url');
        res.writeHead(303,{'Location':'/#new','Set-Cookie':`suflyor_session=${payload}.${sign(payload)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${settings.NODE_ENV==='production'?'; Secure':''}`,'Cache-Control':'no-store'});res.end();return;
      }
      const headers=new Headers();
      // Never trust identity headers supplied by callers on a portable server.
      for(const key of ['content-type','content-length','origin'])if(req.headers[key])headers.set(key,req.headers[key]);
      const request=new Request(url,{method:req.method,headers,...(body?{body}:{}),signal:abort.signal});
      const response=await worker.fetch(request,{...env,REQUEST_USER_ID:sessionValid(req.headers.cookie)?'owner':null});
      res.writeHead(response.status,Object.fromEntries(response.headers));
      res.end(req.method==='HEAD'?undefined:Buffer.from(await response.arrayBuffer()));
    }catch(error){
      if(!res.headersSent)res.writeHead(500,{'Content-Type':'application/json'});
      if(!res.writableEnded)res.end('{"code":"server_error","message":"Ошибка сервера приложения."}');
    }
  });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const port=Number(process.env.PORT||3000);
  createAppServer().listen(port,'0.0.0.0',()=>console.log(`Suflyor listening on port ${port}`));
}
