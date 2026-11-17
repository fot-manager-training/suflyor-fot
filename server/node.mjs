import http from 'node:http';
import {realpathSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import worker from '../dist/server/index.js';
export function createAppServer(settings=process.env){
  if(!settings.DEEPSEEK_API_KEY)throw new Error('Set DEEPSEEK_API_KEY in the server environment.');
  const env={DEEPSEEK_API_KEY:settings.DEEPSEEK_API_KEY,DEEPSEEK_MODEL:settings.DEEPSEEK_MODEL||'deepseek-flash'};
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
        res.writeHead(303,{'Location':'/#new','Cache-Control':'no-store'});res.end();return;
      }
      const headers=new Headers();
      // Never trust identity headers supplied by callers on a portable server.
      for(const key of ['content-type','content-length','origin'])if(req.headers[key])headers.set(key,req.headers[key]);
      headers.set('cf-connecting-ip',req.socket.remoteAddress||'server-visitor');
      const request=new Request(url,{method:req.method,headers,...(body?{body}:{}),signal:abort.signal});
      const response=await worker.fetch(request,env);
      res.writeHead(response.status,Object.fromEntries(response.headers));
      res.end(req.method==='HEAD'?undefined:Buffer.from(await response.arrayBuffer()));
    }catch(error){
      if(!res.headersSent)res.writeHead(500,{'Content-Type':'application/json'});
      if(!res.writableEnded)res.end('{"code":"server_error","message":"Ошибка сервера приложения."}');
    }
  });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(realpathSync(process.argv[1])).href){
  const port=Number(process.env.PORT||3000);
  const server=createAppServer();
  server.listen(port,process.env.HOST||'0.0.0.0',()=>console.log(`Suflyor listening on port ${server.address().port}`));
}
