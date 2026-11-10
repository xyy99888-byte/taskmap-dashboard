import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Miniflare} from 'miniflare';
import worker from '../src/worker.mjs';
import {hash} from '../src/auth.mjs';
let runtime,DB,env,serial=0;
const base='https://dashboard.example.test';
const pass='Test-Pass-14!!';
function req(path,body,cookie,headers={}){return new Request(base+path,{method:body?'POST':'GET',headers:{origin:base,'content-type':'application/json','cf-connecting-ip':'test-'+(++serial),...(cookie?{cookie}:{}),...headers},body:body?JSON.stringify(body):undefined})}
const call=(path,body,cookie,headers)=>worker.fetch(req(path,body,cookie,headers),env);
const cookie=response=>response.headers.get('set-cookie')?.split(';')[0];
async function invite(expires=Math.floor(Date.now()/1000)+600){const token=crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');await DB.prepare('INSERT INTO invitations(token_hash,expires_at) VALUES(?,?)').bind(await hash(token),expires).run();return token}
async function register(username){const response=await call('/api/auth/register',{username,password:pass,invite:await invite()});assert.equal(response.status,201);return {cookie:cookie(response),...(await response.json())}}
before(async()=>{
  runtime=new Miniflare({modules:true,script:'export default {fetch(){return new Response("test")}}',compatibilityDate:'2026-07-01',d1Databases:['DB']});
  DB=await runtime.getD1Database('DB');
  for(const file of ['0001_cloud.sql','0002_accounts.sql']){const sql=await readFile(new URL('../migrations/'+file,import.meta.url),'utf8');for(const statement of sql.split(';').map(x=>x.trim()).filter(Boolean))await DB.prepare(statement).run()}
  env={SERVICE_MODE:'web',AUTH_MODE:'password',DB,ASSETS:{fetch:async()=>new Response('static-page')}};
});
after(async()=>{await runtime?.dispose()});
test('public login works; all project APIs require a valid session, forged Access headers do not authenticate',async()=>{
  assert.equal((await call('/login')).status,200);
  const redirect=await call('/dashboard/?project=private');assert.equal(redirect.status,302);assert.ok(redirect.headers.get('location').startsWith('/login?next='));
  for(const path of ['/api/me','/api/projects','/api/state?project=private'])assert.equal((await call(path,null,null,{'Cf-Access-Authenticated-User-Email':'spoof@x.test'})).status,401);
});
test('register requires unexpired invitation; invitation is consumed exactly once, passwords and sessions stored hashed',async()=>{
  assert.equal((await call('/api/auth/register',{username:'badinvite',password:pass,invite:await invite(1)})).status,400);
  const token=await invite();const first=await call('/api/auth/register',{username:'alice',password:pass,invite:token});assert.equal(first.status,201);
  assert.match(first.headers.get('set-cookie'),/^__Host-progress-session=.+; Path=\/; HttpOnly; Secure; SameSite=Lax;/);
  const result=await first.json();assert.equal(result.recoveryCode.length,64);
  const stored=await DB.prepare('SELECT * FROM accounts WHERE username=?').bind('alice').first();assert.notEqual(stored.password_hash,pass);assert.match(stored.password_hash,/^pbkdf2-sha256\$100000\$/);assert.notEqual(stored.recovery_hash,result.recoveryCode);
  const session=await DB.prepare('SELECT token_hash FROM sessions WHERE account_id=?').bind(stored.id).first();assert.notEqual(session.token_hash,cookie(first).split('=')[1]);
  assert.equal((await call('/api/auth/register',{username:'duplicate',password:pass,invite:token})).status,400);
  const me=await call('/api/me',null,cookie(first));assert.equal((await me.json()).email,'alice');
});
test('concurrent invitation redemption produces at most one account',async()=>{
  const token=await invite();const responses=await Promise.all(['race-one','race-two'].map(username=>call('/api/auth/register',{username,password:pass,invite:token})));
  assert.deepEqual(responses.map(r=>r.status).sort(),[201,400]);
});
test('login failure is generic, cross-origin login rejected, logout and expiry invalidate sessions',async()=>{
  const a=await register('login-test');
  const bad=await call('/api/auth/login',{username:'login-test',password:pass.toLowerCase()}),missing=await call('/api/auth/login',{username:'missing-test',password:pass});assert.equal(bad.status,401);assert.deepEqual(await bad.json(),await missing.json());
  assert.equal((await call('/api/auth/login',{username:'login-test',password:pass},null,{origin:'https://evil.test'})).status,403);
  const logged=await call('/api/auth/login',{username:'login-test',password:pass});assert.equal(logged.status,200);
  assert.equal((await call('/api/auth/logout',{},a.cookie)).status,200);assert.equal((await call('/api/me',null,a.cookie)).status,401);
  await DB.prepare('UPDATE sessions SET expires_at=0 WHERE token_hash=?').bind(await hash(cookie(logged).split('=')[1])).run();assert.equal((await call('/api/me',null,cookie(logged))).status,401);
});
test('real password sessions preserve project isolation and reject cross-origin mutations',async()=>{
  const a=await register('owner-a'),b=await register('owner-b');const created=await (await call('/api/projects',{name:'private A'},a.cookie)).json();
  assert.equal((await call('/api/state?project='+created.id,null,b.cookie)).status,404);
  assert.equal((await call('/api/devices?project='+created.id,null,b.cookie)).status,404);
  const list=await (await call('/api/projects',null,b.cookie)).json();assert.deepEqual(list.projects,[]);
  assert.equal((await call('/api/projects',{name:'csrf'},a.cookie,{origin:'https://evil.test'})).status,403);
});
test('recovery rotates one-time code, revokes every old session and device, retains project ownership',async()=>{
  const a=await register('recover-test'),logged=await call('/api/auth/login',{username:'recover-test',password:pass});
  const me=await DB.prepare('SELECT id FROM accounts WHERE username=?').bind('recover-test').first();
  const project=await (await call('/api/projects',{name:'retained'},a.cookie)).json();
  await DB.prepare('INSERT INTO devices(id,owner_id,project_id,name,token_hash,created_at,expires_at) VALUES(?,?,?,?,?,?,?)').bind('recover-device',me.id,project.id,'test','x'.repeat(64),1,9999999999).run();
  const response=await call('/api/auth/recover',{username:'recover-test',password:pass+'new',recoveryCode:a.recoveryCode});assert.equal(response.status,200);assert.notEqual((await response.json()).recoveryCode,a.recoveryCode);
  for(const old of [a.cookie,cookie(logged)])assert.equal((await call('/api/me',null,old)).status,401);
  assert.equal((await call('/api/auth/recover',{username:'recover-test',password:pass,recoveryCode:a.recoveryCode})).status,401);
  const device=await DB.prepare('SELECT revoked_at FROM devices WHERE id=?').bind('recover-device').first();assert.ok(device.revoked_at);
  assert.equal((await call('/api/state?project='+project.id,null,cookie(response))).status,200);
});
test('password change verifies current password and invalidates other sessions',async()=>{
  const a=await register('password-test');
  assert.equal((await call('/api/auth/password',{currentPassword:pass+'wrong',password:pass+'new'},a.cookie)).status,401);
  const response=await call('/api/auth/password',{currentPassword:pass,password:pass+'new'},a.cookie);assert.equal(response.status,200);
  assert.equal((await call('/api/me',null,a.cookie)).status,401);assert.equal((await call('/api/me',null,cookie(response))).status,200);
});
test('credential guessing is rate limited and weak passwords rejected',async()=>{
  assert.equal((await call('/api/auth/register',{username:'weak-test',password:'1234567890123',invite:await invite()})).status,400);
  let response;for(let i=0;i<11;i++)response=await call('/api/auth/login',{username:'bruteforce',password:pass});assert.equal(response.status,429);
});

test('new passwords need two character categories; uppercase and lowercase alone are one category',async()=>{
  for(const value of ['OnlyLettersAbCd','12345678901234','letters and spaces']){
    const response=await call('/api/auth/register',{username:'category-rejected',password:value,invite:await invite()});
    assert.equal(response.status,400);assert.match((await response.json()).error,/至少两类/);
  }
  for(const [index,value] of ['abcdefghijk123','1234567890123!','abcdefghijklm!'].entries()){
    const response=await call('/api/auth/register',{username:'category-valid-'+index,password:value,invite:await invite()});
    assert.equal(value.length,14);assert.equal(response.status,201);
  }
  const account=await register('policy-change');
  assert.equal((await call('/api/auth/password',{currentPassword:pass,password:'OnlyLettersAbCd'},account.cookie)).status,400);
  assert.equal((await call('/api/auth/recover',{username:'policy-change',password:'12345678901234',recoveryCode:account.recoveryCode})).status,400);
});
