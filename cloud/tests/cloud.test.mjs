import {test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Miniflare} from 'miniflare';
import {generateKeyPair,exportJWK,SignJWT,createLocalJWKSet} from 'jose';
import worker,{webApi,syncApi,identity,snapshot,digest} from '../src/worker.mjs';

let runtime,DB;
let userA={id:'owner-alice',email:'alice@example.test'},userB={id:'owner-bob',email:'bob@example.test'};
const base='https://dashboard.example.test';
function request(path,method='GET',value,headers={}){
  return new Request(base+path,{method,headers:{...(value?{'content-type':'application/json',origin:base}:{}),...headers},body:value?JSON.stringify(value):undefined});
}
async function createProject(owner,name='测试项目'){
  return (await webApi(request('/api/projects','POST',{name}),{DB},owner)).json();
}
async function pair(owner,projectId){
  const start=await (await syncApi(request('/v1/pair/start','POST',{deviceName:'测试电脑'}),{DB})).json();
  await webApi(request('/api/pairing/approve','POST',{code:start.code,projectId}),{DB},owner);
  const issued=await (await syncApi(request('/v1/pair/status','POST',{code:start.code,pollSecret:start.pollSecret}),{DB})).json();
  return {...issued,code:start.code,pollSecret:start.pollSecret};
}
function data(){return {project:'私有项目',generatedAt:new Date().toISOString(),sourceHealth:{codex:'disabled'},lanes:[{id:'main',title:'开发',color:'#5b72e8',windows:[{id:'work',title:'实施窗口',sourceKind:'update',reviewedAt:new Date().toISOString(),tasks:[{id:'one',title:'任务一',status:'done',stage:'local'},{id:'two',title:'任务二',status:'todo',dependsOn:['one']}]}]}]}}
function upload(device,sequence=1){return syncApi(request('/v1/snapshot','POST',{sequence,snapshot:data()},{authorization:'Bearer '+device.token}),{DB})}

test('schedule and bounded observed history survive cloud normalization without trusting extra fields',()=>{
  const input=data(),task=input.lanes[0].windows[0].tasks[0];
  Object.assign(task,{startsOn:'2026-11-10',dueOn:'2026-11-13',completedAt:'2026-11-13T23:00:00+08:00'});
  input.history={startedAt:'2026-11-10T00:00:00Z',events:Array.from({length:205},(_,i)=>({id:String(i),kind:'status',observedAt:'2026-11-13T15:01:00Z',taskId:'one',status:'done',previousStatus:'todo',total:2,done:1,secret:'not allowed'}))};
  const result=snapshot(input);
  assert.equal(result.lanes[0].windows[0].tasks[0].dueOn,'2026-11-13');
  assert.equal(result.lanes[0].windows[0].tasks[0].completedAt,'2026-11-13T15:00:00.000Z');
  assert.equal(result.history.events.length,200);
  assert.equal(result.history.events[0].secret,undefined);
  task.startsOn='2026-02-30'; task.completedAt='2026-11-13T15:00:00';
  const invalid=snapshot(input).lanes[0].windows[0].tasks[0];
  assert.equal(invalid.startsOn,null);assert.equal(invalid.completedAt,null);assert.ok(invalid.scheduleWarning);
  task.startsOn='2026-11-15';assert.ok(snapshot(input).lanes[0].windows[0].tasks[0].scheduleWarning);
  assert.deepEqual(snapshot(data()).history.events,[]);
  input.history.events=[{id:'review',kind:'review',observedAt:'2026-11-10T03:00:00Z',reviewedAt:'2026-11-08T09:00:00Z',windowId:'work',sourceKind:'update'}];
  const review=snapshot(input).history.events[0];
  assert.equal(review.reviewedAt,'2026-11-08T09:00:00.000Z');assert.equal(review.observedAt,'2026-11-10T03:00:00.000Z');
  assert.equal(review.sourceKind,'update');
});

before(async()=>{
  runtime=new Miniflare({modules:true,script:'export default {fetch(){return new Response("test")}}',compatibilityDate:'2026-07-01',d1Databases:['DB']});
  DB=await runtime.getD1Database('DB');
  for(const file of ['0001_cloud.sql','0003_trial_limits.sql']){const sql=await readFile(new URL('../migrations/'+file,import.meta.url),'utf8');for(const statement of sql.split(';').map(x=>x.trim()).filter(Boolean))await DB.prepare(statement).run();}
});
after(async()=>{await runtime?.dispose()});
beforeEach(()=>{userA={id:'alice-'+crypto.randomUUID(),email:'alice@example.test'};userB={id:'bob-'+crypto.randomUUID(),email:'bob@example.test'};});

test('Cloudflare JWT signature, audience, issuer and expiry must match',async()=>{
  const {privateKey,publicKey}=await generateKeyPair('RS256');const key=await exportJWK(publicKey);key.kid='test-key';
  const resolver=createLocalJWKSet({keys:[key]}),env={ACCESS_TEAM_DOMAIN:'test.cloudflareaccess.com',ACCESS_AUD:'test-audience'};
  const sign=(aud,exp='5m')=>new SignJWT({email:'alice@example.test',type:'app'}).setProtectedHeader({alg:'RS256',kid:'test-key'}).setIssuer('https://test.cloudflareaccess.com').setAudience(aud).setSubject('test-user').setIssuedAt().setExpirationTime(exp).sign(privateKey);
  const jwt=await sign('test-audience');
  assert.equal((await identity(request('/api/me','GET',null,{'Cf-Access-Jwt-Assertion':jwt}),env,resolver)).email,'alice@example.test');
  await assert.rejects(identity(request('/api/me','GET',null,{'Cf-Access-Jwt-Assertion':await sign('wrong-audience')}),env,resolver),e=>e.status===401);
  await assert.rejects(identity(request('/api/me','GET',null,{'Cf-Access-Jwt-Assertion':await sign('test-audience',Math.floor(Date.now()/1000)-60)}),env,resolver),e=>e.status===401);
  await assert.rejects(identity(request('/api/me','GET',null,{'Cf-Access-Authenticated-User-Email':'forged@example.test'}),env,resolver),e=>e.status===401);
});

test('unconfigured or unauthenticated web service fails closed before assets',async()=>{
  const response=await worker.fetch(request('/'),{SERVICE_MODE:'web',DB});assert.equal(response.status,503);
  const response2=await worker.fetch(request('/api/state'),{SERVICE_MODE:'web',DB,ACCESS_TEAM_DOMAIN:'test.cloudflareaccess.com',ACCESS_AUD:'test'});assert.equal(response2.status,401);
});

test('two accounts have isolated project lists, state and devices',async()=>{
  const a=await createProject(userA),b=await createProject(userB);
  const list=await (await webApi(request('/api/projects'),{DB},userB)).json();
  assert.ok(list.projects.some(p=>p.id===b.id));assert.ok(!list.projects.some(p=>p.id===a.id));
  await assert.rejects(webApi(request('/api/state?project='+a.id),{DB},userB),e=>e.status===404);
  await assert.rejects(webApi(request('/api/devices?project='+a.id),{DB},userB),e=>e.status===404);
});

test('web mutations reject foreign origins',async()=>{
  await assert.rejects(webApi(request('/api/projects','POST',{name:'forged'},{origin:'https://elsewhere.test'}),{DB},userA),e=>e.status===403);
});

test('pairing needs approval, correct poll secret and project ownership',async()=>{
  const project=await createProject(userA);
  const start=await (await syncApi(request('/v1/pair/start','POST',{deviceName:'电脑'}),{DB})).json();
  const poll={code:start.code,pollSecret:start.pollSecret};
  assert.equal((await(await syncApi(request('/v1/pair/status','POST',poll),{DB})).json()).status,'pending');
  await assert.rejects(syncApi(request('/v1/pair/status','POST',{...poll,pollSecret:'incorrect'}),{DB}),e=>e.status===404);
  await assert.rejects(webApi(request('/api/pairing/approve','POST',{code:start.code,projectId:project.id}),{DB},userB),e=>e.status===404);
  await DB.prepare('UPDATE pairings SET expires_at=0 WHERE code=?').bind(start.code).run();
  await assert.rejects(webApi(request('/api/pairing/approve','POST',{code:start.code,projectId:project.id}),{DB},userA),e=>e.status===404);
});

test('approved pairing produces one upload token and cannot be replayed',async()=>{
  const project=await createProject(userA),device=await pair(userA,project.id);
  assert.equal(device.projectId,project.id);assert.equal(device.token.length,64);
  const stored=await DB.prepare('SELECT token_hash FROM devices WHERE id=?').bind(device.deviceId).first();
  assert.equal(stored.token_hash,await digest(device.token));assert.notEqual(stored.token_hash,device.token);
  await assert.rejects(syncApi(request('/v1/pair/status','POST',{code:device.code,pollSecret:device.pollSecret}),{DB}),e=>e.status===409);
});

test('token scoped upload, ordering, cross-account revoke and revocation enforced',async()=>{
  const project=await createProject(userA),device=await pair(userA,project.id);
  assert.equal((await upload(device,2)).status,200);
  const state=await (await webApi(request('/api/state?project='+project.id),{DB},userA)).json();
  assert.equal(state.lanes[0].windows[0].percent,50);assert.equal(state.transport.online,true);
  await assert.rejects(upload(device,1),e=>e.status===409);
  await assert.rejects(webApi(request('/api/devices/revoke','POST',{id:device.deviceId}),{DB},userB),e=>e.status===404);
  await webApi(request('/api/devices/revoke','POST',{id:device.deviceId}),{DB},userA);
  await assert.rejects(upload(device,3),e=>e.status===401);
  const offline=await (await webApi(request('/api/state?project='+project.id),{DB},userA)).json();
  assert.equal(offline.transport.online,false);assert.equal(offline.lanes.length,1);
  const projects=await (await webApi(request('/api/projects'),{DB},userA)).json();
  assert.equal(projects.projects.find(p=>p.id===project.id).online,false);
});

test('another active computer cannot overwrite project until old source revoked',async()=>{
  const project=await createProject(userB),first=await pair(userB,project.id),second=await pair(userB,project.id);
  await upload(first,1);await assert.rejects(upload(second,1),e=>e.status===409);
  await webApi(request('/api/devices/revoke','POST',{id:first.deviceId}),{DB},userB);
  assert.equal((await upload(second,1)).status,200);
});

test('server recomputes percentages and strips unknown snapshot fields',()=>{
  const input=data();input.password='do-not-copy';input.lanes[0].windows[0].percent=99;
  const result=snapshot(input);assert.equal(result.password,undefined);assert.equal(result.lanes[0].windows[0].percent,50);
  input.lanes[0].windows[0].tasks[1].id='one';assert.throws(()=>snapshot(input),e=>e.status===400);
});

test('public sync endpoint never serves data and rejects absent credentials',async()=>{
  const response=await worker.fetch(request('/api/state'),{SERVICE_MODE:'sync',DB});assert.equal(response.status,405);
  await assert.rejects(syncApi(request('/v1/snapshot','POST',{snapshot:data(),sequence:1}),{DB}),e=>e.status===401);
});


test('trial project creation is atomic at ten per owner and separate between owners',async()=>{
  for(let i=0;i<9;i++)await createProject(userA);await createProject(userB);
  const attempts=await Promise.allSettled([createProject(userA),createProject(userA),createProject(userA)]);
  assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);
  assert.ok(attempts.filter(r=>r.status==='rejected').every(r=>r.reason.status===422));
  const list=await(await webApi(request('/api/projects'),{DB},userA)).json();
  assert.equal(list.projects.length,10);assert.equal(list.trial.maxProjects,10);assert.equal(list.trial.charging,false);
  assert.equal((await(await webApi(request('/api/projects'),{DB},userB)).json()).projects.length,1);
});
function windowsData(count){return {project:'额度测试',lanes:[{id:'a',windows:Array.from({length:Math.min(count,6)},(_,i)=>({id:'w'+i,tasks:[]}))},{id:'b',windows:Array.from({length:Math.max(0,count-6)},(_,i)=>({id:'other'+i,tasks:[]}))}]};}
function uploadData(device,count,sequence){return syncApi(request('/v1/snapshot','POST',{sequence,snapshot:windowsData(count)},{authorization:'Bearer '+device.token}),{DB});}
test('window quota spans modules and empty windows; overflow preserves snapshot and recovery clears the issue',async()=>{
  const project=await createProject(userA),device=await pair(userA,project.id);
  assert.equal((await uploadData(device,10,1)).status,200);
  await assert.rejects(uploadData(device,11,2),e=>e.status===422&&e.message.includes('现阶段不收费'));
  let state=await(await webApi(request('/api/state?project='+project.id),{DB},userA)).json();
  assert.equal(state.lanes.flatMap(l=>l.windows).length,10);assert.equal(state.trial.windowLimit,10);
  assert.equal(state.transport.syncIssue.kind,'window_limit');assert.ok(state.warnings.some(w=>w.includes('11')));
  assert.equal((await DB.prepare('SELECT sequence FROM snapshots WHERE project_id=?').bind(project.id).first()).sequence,1);
  await uploadData(device,9,3);
  state=await(await webApi(request('/api/state?project='+project.id),{DB},userA)).json();
  assert.equal(state.trial.usedWindows,9);assert.equal(state.transport.syncIssue,null);assert.deepEqual(state.warnings,[]);
  await assert.rejects(uploadData(device,11,4),e=>e.status===422);
  await webApi(request('/api/devices/revoke','POST',{id:device.deviceId}),{DB},userA);
  assert.equal((await(await webApi(request('/api/state?project='+project.id),{DB},userA)).json()).transport.syncIssue,null);
});
test('first over-quota upload leaves empty state with feedback and no cross-account visibility',async()=>{
  const project=await createProject(userA),device=await pair(userA,project.id);
  await assert.rejects(uploadData(device,11,1),e=>e.status===422);
  const state=await(await webApi(request('/api/state?project='+project.id),{DB},userA)).json();
  assert.equal(state.lanes.length,0);assert.equal(state.transport.receivedAt,null);assert.equal(state.trial.usedWindows,0);assert.ok(state.warnings.length);
  await assert.rejects(webApi(request('/api/state?project='+project.id),{DB},userB),e=>e.status===404);
});
test('migration grants a fixed legacy window allowance without losing older projects',async()=>{
  const project=await createProject(userA),device=await pair(userA,project.id);
  const serialized=JSON.stringify(snapshot(windowsData(13)));
  await DB.prepare('INSERT INTO snapshots(project_id,device_id,body,received_at,sequence) VALUES(?,?,?,?,?)').bind(project.id,device.deviceId,serialized,Math.floor(Date.now()/1000),1).run();
  for(let i=0;i<10;i++)await DB.prepare('INSERT INTO projects(id,owner_id,name,created_at) VALUES(?,?,?,?)').bind(crypto.randomUUID(),userA.id,'历史项目',1).run();
  const migration=await readFile(new URL('../migrations/0003_trial_limits.sql',import.meta.url),'utf8');
  for(const statement of migration.split(';').map(x=>x.trim()).filter(Boolean))await DB.prepare(statement).run();
  assert.equal((await uploadData(device,13,2)).status,200);
  await assert.rejects(uploadData(device,14,3),e=>e.status===422);
  const list=await(await webApi(request('/api/projects'),{DB},userA)).json();
  assert.equal(list.projects.length,11);assert.equal(list.projects.find(p=>p.id===project.id).windowLimit,13);
  await assert.rejects(createProject(userA),e=>e.status===422);
  await uploadData(device,8,4);assert.equal((await uploadData(device,13,5)).status,200);
});


test('only server-granted author account bypasses project and window quotas',async()=>{
  await DB.prepare('INSERT INTO account_entitlements(owner_id,unlimited) VALUES(?,1)').bind(userA.id).run();
  for(let i=0;i<11;i++)await createProject(userA);
  const list=await(await webApi(request('/api/projects'),{DB},userA)).json();
  assert.equal(list.projects.length,11);assert.equal(list.trial.exempt,true);assert.equal(list.trial.maxProjects,null);
  const project=list.projects[0],device=await pair(userA,project.id);
  assert.equal((await uploadData(device,15,1)).status,200);
  const state=await(await webApi(request('/api/state?project='+project.id),{DB},userA)).json();
  assert.equal(state.trial.windowLimit,null);assert.equal(state.trial.usedWindows,15);
  assert.equal(list.projects[0].windowLimit,null);
  const regular=await(await webApi(request('/api/projects'),{DB},userB)).json();
  assert.equal(regular.trial.exempt,false);assert.equal(regular.trial.maxProjects,10);
  const other=await(await webApi(request('/api/projects','POST',{name:'不能自授',unlimited:true,exempt:true}),{DB},userB)).json();
  await assert.rejects(uploadData(await pair(userB,other.id),11,1),e=>e.status===422);
});
