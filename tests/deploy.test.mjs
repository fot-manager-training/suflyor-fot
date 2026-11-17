import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,statSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const render=(...args)=>execFileSync('python3',['deploy/render-vps.py',...args],{encoding:'utf8'});
test('VPS installer has valid shell syntax and help runs without server changes',()=>{
 execFileSync('bash',['-n','deploy/install-vps.sh']);assert.match(execFileSync('bash',['deploy/install-vps.sh','--help'],{encoding:'utf8'}),/Ubuntu/);
});
test('Nginx renderer supports public IPv4 and retains HTTP ACME validation after TLS',()=>{
 assert.equal(render('kind','--host','186.243.223.43').trim(),'ipv4');
 const bootstrap=render('nginx','--host','186.243.223.43');assert.match(bootstrap,/\.well-known\/acme-challenge/);assert.equal(bootstrap.includes('ssl_certificate'),false);
 const tls=render('nginx','--host','186.243.223.43','--tls');assert.match(tls,/listen 443 ssl/);assert.match(tls,/proxy_pass http:\/\/127\.0\.0\.1:3000/);assert.match(tls,/proxy_read_timeout 240s/);assert.match(tls,/return 301 https:\/\/\$host\$request_uri/);
 assert.equal(render('kind','--host','suflyor.example.com').trim(),'domain');
 assert.throws(()=>render('kind','--host','https://example.com; bad'));
});
test('server credentials are read through stdin and saved with private file permissions',()=>{
 const directory=mkdtempSync(join(tmpdir(),'suflyor-env-'));try{
  const path=join(directory,'environment');const secret='test-key-with-"quotes"-$dollar-and-backslash\\';
  execFileSync('python3',['deploy/render-vps.py','environment','--path',path],{input:secret});
  const text=readFileSync(path,'utf8');assert.equal(statSync(path).mode&0o777,0o600);assert.ok(text.includes('DEEPSEEK_API_KEY='+JSON.stringify(secret)));assert.match(text,/HOST="127\.0\.0\.1"/);assert.match(text,/NODE_ENV="production"/);assert.doesNotMatch(text,/APP_PASSWORD|APP_SESSION_SECRET/);
  assert.throws(()=>execFileSync('python3',['deploy/render-vps.py','environment','--path',path],{input:'key\nOTHER=value'}));
  assert.equal(readFileSync(path,'utf8'),text);
 }finally{rmSync(directory,{recursive:true,force:true});}
});
test('application and certificate services use non-root runtime and automatic renewal',()=>{
 const service=readFileSync('deploy/suflyor.service','utf8');assert.match(service,/User=suflyor/);assert.match(service,/EnvironmentFile=\/etc\/suflyor\/environment/);assert.match(service,/Restart=on-failure/);
 const timer=readFileSync('deploy/suflyor-cert-renew.timer','utf8');assert.match(timer,/OnCalendar=hourly/);assert.match(timer,/Persistent=true/);
 const installer=readFileSync('deploy/install-vps.sh','utf8');assert.match(installer,/--ip-address/);assert.match(installer,/--preferred-profile shortlived/);assert.match(installer,/certbot>=5\.4,<6/);assert.match(installer,/--register-unsafely-without-email/);assert.doesNotMatch(installer,/SUF_EMAIL|SUF_PASSWORD|SUF_CONFIRM|--email/);
});

test('activation does not roll back a first install to a nonexistent current link',()=>{
 const source=readFileSync('deploy/install-vps.sh','utf8');
 const activation=source.slice(source.indexOf('activate() {'),source.indexOf('build_release() {'));
 const directory=mkdtempSync(join(tmpdir(),'suflyor-activate-'));
 try{
  execFileSync('bash',['-c',`set -eu
SUF_ROOT="$1"
mkdir -p "$SUF_ROOT/releases/new/server" "$SUF_ROOT/releases/new/dist/server"
touch "$SUF_ROOT/releases/new/server/node.mjs" "$SUF_ROOT/releases/new/dist/server/index.js"
systemctl() { return 0; }
health() { return 1; }
fail() { exit 33; }
${activation}
activate "$SUF_ROOT/releases/new"
`,'test',directory]);
  assert.fail('activation should fail its health check');
 }catch(error){assert.equal(error.status,33);assert.equal(execFileSync('readlink',['-e',join(directory,'current')],{encoding:'utf8'}).trim(),join(directory,'releases/new'));}
 finally{rmSync(directory,{recursive:true,force:true});}
});
