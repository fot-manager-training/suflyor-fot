import {mkdirSync,readFileSync,writeFileSync,rmSync,cpSync,existsSync} from 'node:fs';
rmSync('dist',{recursive:true,force:true});mkdirSync('dist/server',{recursive:true});mkdirSync('dist/.openai',{recursive:true});
const assets={};
for(const file of ['index.html','app.js','sw.js','manifest.webmanifest','icon.svg']){
 let body=readFileSync(`suflyor/${file}`,'utf8').replaceAll('../theme.','./theme.');
 if(file==='sw.js')body=body.replace('suflyor-shell-v2','suflyor-shell-v7');
 assets['/'+file]={body,type:file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.js')?'text/javascript; charset=utf-8':file.endsWith('.svg')?'image/svg+xml':'application/manifest+json'};
}
for(const file of ['theme.js','theme.css','robots.txt'])assets['/'+file]={body:readFileSync(file,'utf8'),type:file.endsWith('.css')?'text/css':file.endsWith('.js')?'text/javascript':'text/plain'};
writeFileSync('dist/server/index.js','const ASSETS='+JSON.stringify(assets)+';\n'+readFileSync('worker/index.mjs','utf8'));
if(existsSync('.openai/hosting.json'))cpSync('.openai/hosting.json','dist/.openai/hosting.json');
