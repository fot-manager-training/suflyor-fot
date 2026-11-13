import {mkdirSync,readFileSync,writeFileSync,rmSync,cpSync,existsSync} from 'node:fs';
import {build} from 'esbuild';
rmSync('dist',{recursive:true,force:true});mkdirSync('dist/server',{recursive:true});mkdirSync('dist/.openai',{recursive:true});
const bundled=await build({entryPoints:['suflyor/document-reader.mjs'],bundle:true,minify:true,format:'iife',globalName:'SuflyorDocs',platform:'browser',target:['es2022'],external:['node:*'],write:false,logLevel:'error'});
const assets={};
for(const file of ['index.html','app.js','sw.js','manifest.webmanifest','icon.svg','knowledge.json']){
 let body=readFileSync(`suflyor/${file}`,'utf8').replaceAll('../theme.','./theme.');
 if(file==='sw.js')body=body.replace('suflyor-shell-v2','suflyor-shell-v9');
 assets['/'+file]={body,type:file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.js')?'text/javascript; charset=utf-8':file.endsWith('.svg')?'image/svg+xml':file.endsWith('.json')?'application/json; charset=utf-8':'application/manifest+json'};
}
assets['/document-reader.js']={body:bundled.outputFiles[0].text,type:'text/javascript; charset=utf-8'};
assets['/pdf.worker.min.mjs']={body:readFileSync('node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs','utf8'),type:'text/javascript; charset=utf-8'};
for(const file of ['theme.js','theme.css','robots.txt'])assets['/'+file]={body:readFileSync(file,'utf8'),type:file.endsWith('.css')?'text/css':file.endsWith('.js')?'text/javascript':'text/plain'};
const server=await build({entryPoints:['worker/index.mjs'],bundle:true,format:'esm',platform:'browser',target:['es2022'],write:false,logLevel:'error'});
writeFileSync('dist/server/index.js','const ASSETS='+JSON.stringify(assets)+';\n'+server.outputFiles[0].text);
if(existsSync('.openai/hosting.json'))cpSync('.openai/hosting.json','dist/.openai/hosting.json');
