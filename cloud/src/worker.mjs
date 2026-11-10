import {createRemoteJWKSet, jwtVerify} from 'jose';
import {AuthError,authApi,nativeIdentity} from './auth.mjs';

const encoder=new TextEncoder();
const jwksCache=new Map();
const statuses=new Set(['todo','in_progress','review','blocked','done','cancelled']);
const MAX_BODY=512*1024;
class HttpError extends Error {constructor(status,message){super(message);this.status=status}}
const fail=(status,message)=>{throw new HttpError(status,message)};
const now=()=>Math.floor(Date.now()/1000);
const iso=seconds=>new Date(seconds*1000).toISOString();
const text=(value,max=4000)=>typeof value==='string'?value.slice(0,max):'';
const randomToken=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
export const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}})}
function secured(response){
  const output=new Response(response.body,response);
  output.headers.set('Cache-Control','no-store');
  output.headers.set('X-Content-Type-Options','nosniff');
  output.headers.set('Referrer-Policy','no-referrer');
  output.headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
  return output;
}
async function body(request){
  if(!request.headers.get('content-type')?.includes('application/json'))fail(415,'请使用 JSON 请求。');
  if(Number(request.headers.get('content-length'))>MAX_BODY)fail(413,'进度数据过大。');
  const reader=request.body?.getReader();if(!reader)fail(400,'缺少请求内容。');
  const chunks=[];let size=0;
  while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_BODY){await reader.cancel();fail(413,'进度数据过大。')}chunks.push(value)}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
  try {const value=JSON.parse(new TextDecoder().decode(bytes));if(!value||Array.isArray(value)||typeof value!=='object')fail(400,'JSON 格式不正确。');return value;}catch(e){if(e instanceof HttpError)throw e;fail(400,'JSON 格式不正确。')}
}
function sameOrigin(request){
  if(request.headers.get('origin')!==new URL(request.url).origin)fail(403,'请求来源不匹配，请从网站操作。');
}
export async function identity(request,env,resolver){
  if(env.AUTH_MODE==='password')return nativeIdentity(request,env);
  if(env.AUTH_MODE&&env.AUTH_MODE!=='access')fail(503,'登录方式配置不正确。');
  const domain=env.ACCESS_TEAM_DOMAIN,audience=env.ACCESS_AUD;
  if(!domain||!audience||!/^[-a-z0-9]+\.cloudflareaccess\.com$/i.test(domain)||audience.startsWith('REPLACE'))fail(503,'登录服务尚未配置，项目数据未开放。');
  const jwt=request.headers.get('Cf-Access-Jwt-Assertion');if(!jwt)fail(401,'请通过登录入口访问看板。');
  const issuer='https://'+domain;
  if(!resolver){if(!jwksCache.has(issuer))jwksCache.set(issuer,createRemoteJWKSet(new URL(issuer+'/cdn-cgi/access/certs'),{timeoutDuration:5000}));resolver=jwksCache.get(issuer)}
  try {
    const {payload}=await jwtVerify(jwt,resolver,{issuer,audience,algorithms:['RS256'],requiredClaims:['exp','iat','sub'],clockTolerance:10});
    if(!payload.sub||typeof payload.email!=='string'||payload.type!=='app')fail(401,'需要个人用户登录。');
    return {id:await digest(issuer+'|'+payload.sub),email:payload.email};
  } catch {fail(401,'登录已失效，请重新登录。')}
}
async function rateLimit(db,key,limit,period){
  const time=now(),bucket=await digest(key+'|'+Math.floor(time/period));
  const row=await db.prepare('INSERT INTO rate_limits(bucket,count,expires_at) VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET count=count+1 RETURNING count').bind(bucket,time+period).first();
  if(row.count>limit)fail(429,'请求过于频繁，请稍后重试。');
}
async function ownedProject(db,id,owner){
  const result=await db.prepare('SELECT id,name,created_at FROM projects WHERE id=? AND owner_id=?').bind(text(id,100),owner).first();
  if(!result)fail(404,'没有找到此项目。');return result;
}
function date(value){return typeof value==='string'&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():null}
function day(value){return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&date(value)?.slice(0,10)===value?value:null}
function schedule(task){
  const startsOn=day(task.startsOn),dueOn=day(task.dueOn);
  const completedAt=typeof task.completedAt==='string'&&/(Z|[+-]\d{2}:\d{2})$/.test(task.completedAt)?date(task.completedAt):null;
  const invalid=(task.startsOn&&!startsOn)||(task.dueOn&&!dueOn)||(task.completedAt&&!completedAt)||(startsOn&&dueOn&&startsOn>dueOn);
  return {startsOn,dueOn,completedAt,scheduleWarning:invalid?'排期日期无效，请核对开始、截止及完成时间。':text(task.scheduleWarning,100)};
}
function timelineHistory(value){
  const count=n=>Math.max(0,Math.min(2000,Math.trunc(Number(n)||0)));
  return {startedAt:date(value?.startedAt),limit:200,error:value?.error===true,events:(Array.isArray(value?.events)?value.events:[]).slice(0,200).filter(e=>e&&['baseline','added','removed','status','schedule'].includes(e.kind)&&date(e.observedAt)).map(e=>({
    id:text(e.id,100),kind:e.kind,observedAt:date(e.observedAt),taskId:text(e.taskId,200),laneId:text(e.laneId,100),windowId:text(e.windowId,100),title:text(e.title,240),lane:text(e.lane,160),window:text(e.window,160),status:statuses.has(e.status)?e.status:null,previousStatus:statuses.has(e.previousStatus)?e.previousStatus:null,total:count(e.total),done:Math.min(count(e.done),count(e.total)),...schedule(e)
  }))};
}

export function snapshot(input){
  if(!Array.isArray(input?.lanes)||input.lanes.length>60)fail(400,'项目模块格式不正确。');
  const ids=new Set(),taskIds=new Set();let total=0;
  const lanes=input.lanes.map(lane=>{
    if(!lane||typeof lane.id!=='string'||!lane.id||!Array.isArray(lane.windows)||lane.windows.length>100)fail(400,'模块需要唯一编号及窗口清单。');
    if(ids.has('lane:'+lane.id))fail(400,'模块编号重复。');ids.add('lane:'+lane.id);
    return {id:text(lane.id,100),title:text(lane.title,160),color:/^#[0-9a-f]{6}$/i.test(lane.color)?lane.color:'#5b72e8',windows:lane.windows.map(window=>{
      if(!window?.id||ids.has('window:'+window.id)||!Array.isArray(window.tasks))fail(400,'窗口编号重复或任务格式不正确。');
      ids.add('window:'+window.id);
      const tasks=window.tasks.map(task=>{
        total++;if(total>2000)fail(400,'任务超过 2000 项，请拆分项目。');
        const status=task.status??(task.done===true?'done':task.done===false?'todo':null);
        if(!statuses.has(status)||!task.id||taskIds.has(task.id)||typeof task.title!=='string')fail(400,'任务编号或状态不正确。');
        taskIds.add(task.id);
        return {id:text(task.id,200),title:text(task.title,600),status,done:status==='done',priority:['P0','P1','P2','P3'].includes(task.priority)?task.priority:'P2',
          stage:text(task.stage,40),acceptance:text(task.acceptance),evidence:text(task.evidence,8000),blocker:text(task.blocker),nextAction:text(task.nextAction),group:text(task.group,200),milestone:text(task.milestone,200),...schedule(task),
          dependsOn:Array.isArray(task.dependsOn)?task.dependsOn.filter(id=>typeof id==='string').slice(0,100).map(id=>text(id,200)):[]};
      });
      const counted=tasks.filter(t=>t.status!=='cancelled'),done=counted.filter(t=>t.done).length;
      const reviewedAt=date(window.reviewedAt),updatedAt=date(window.updatedAt);
      return {id:text(window.id,100),title:text(window.title,200),summary:text(window.summary),evidence:text(window.evidence,8000),owner:text(window.owner,160),tasks,reviewedAt,updatedAt,
        activity:['进行中','空闲','已中断','出错','未知'].includes(window.activity)?window.activity:'未接入',sourceKind:['update','markdown','project'].includes(window.sourceKind)?window.sourceKind:'project',
        taskCount:counted.length,doneCount:done,percent:counted.length?Math.round(done/counted.length*100):null,needsReview:!reviewedAt||(updatedAt&&Date.parse(updatedAt)>Date.parse(reviewedAt))};
    })};
  });
  const tasks=lanes.flatMap(l=>l.windows.flatMap(w=>w.tasks)),byId=new Map(tasks.map(t=>[t.id,t]));
  for(const task of tasks)task.unmetDependencies=task.dependsOn.filter(id=>!byId.has(id)||!byId.get(id).done).map(id=>({id,title:byId.get(id)?.title||id,missing:!byId.has(id)}));
  return {project:text(input.project,160)||'未命名项目',scope:text(input.scope,800),lanes,history:timelineHistory(input.history),generatedAt:date(input.generatedAt),schemaVersion:2,timezone:text(input.timezone,80)||'Asia/Shanghai',refreshSeconds:10,
    warnings:Array.isArray(input.warnings)?input.warnings.slice(0,20).map(x=>text(x,400)):[],sourceHealth:{codex:['ok','partial','disabled','unavailable'].includes(input.sourceHealth?.codex)?input.sourceHealth.codex:'unavailable',markdownBoards:Math.max(0,Math.min(100,Number(input.sourceHealth?.markdownBoards)||0))}};
}

export async function webApi(request,env,user){
  const url=new URL(request.url),path=url.pathname,db=env.DB;
  if(request.method==='GET'&&path==='/api/me')return json({email:user.email});
  if(request.method==='GET'&&path==='/api/projects'){
    const {results}=await db.prepare('SELECT p.id,p.name,p.created_at,s.received_at,d.revoked_at FROM projects p LEFT JOIN snapshots s ON s.project_id=p.id LEFT JOIN devices d ON d.id=s.device_id WHERE p.owner_id=? ORDER BY p.created_at DESC').bind(user.id).all();
    return json({projects:results.map(p=>({id:p.id,name:p.name,created_at:p.created_at,received_at:p.received_at,online:!!p.received_at&&!p.revoked_at&&now()-p.received_at<90}))});
  }
  if(request.method==='POST'&&path==='/api/projects'){
    sameOrigin(request);const value=await body(request);const name=text(value.name,120).trim();if(!name)fail(400,'请填写项目名称。');
    await rateLimit(db,'project:'+user.id,20,3600);
    const id=crypto.randomUUID();await db.prepare('INSERT INTO projects(id,owner_id,name,created_at) VALUES(?,?,?,?)').bind(id,user.id,name,now()).run();return json({id,name},201);
  }
  if(request.method==='GET'&&path==='/api/state'){
    const project=await ownedProject(db,url.searchParams.get('project'),user.id);
    const row=await db.prepare('SELECT s.body,s.received_at,d.name,d.revoked_at FROM snapshots s JOIN devices d ON d.id=s.device_id WHERE s.project_id=?').bind(project.id).first();
    const data=row?JSON.parse(row.body):{project:project.name,scope:'尚未连接本机。请回到项目列表连接一台电脑。',lanes:[],warnings:[],sourceHealth:{codex:'disabled',markdownBoards:0},refreshSeconds:10,timezone:'Asia/Shanghai'};
    data.project=project.name;data.serverCheckAt=iso(now());data.transport={mode:'cloud',receivedAt:row?iso(row.received_at):null,online:!!row&&!row.revoked_at&&now()-row.received_at<90,deviceName:row?.name||null};
    return json(data);
  }
  if(request.method==='GET'&&path==='/api/devices'){
    const project=await ownedProject(db,url.searchParams.get('project'),user.id);
    const {results}=await db.prepare('SELECT id,name,created_at,expires_at,revoked_at,last_seen_at FROM devices WHERE project_id=? AND owner_id=? ORDER BY created_at DESC').bind(project.id,user.id).all();return json({devices:results});
  }
  if(request.method==='POST'&&path==='/api/devices/revoke'){
    sameOrigin(request);const value=await body(request);
    const result=await db.prepare('UPDATE devices SET revoked_at=? WHERE id=? AND owner_id=? AND revoked_at IS NULL').bind(now(),text(value.id,100),user.id).run();
    if(!result.meta.changes)fail(404,'没有找到此设备。');return json({ok:true});
  }
  if(request.method==='GET'&&path==='/api/pairing'){
    const code=text(url.searchParams.get('code'),20).toUpperCase().replace(/-/g,'');
    await rateLimit(db,'pair-read:'+user.id,40,600);
    const pairing=await db.prepare("SELECT code,device_name,expires_at FROM pairings WHERE code=? AND status='pending' AND expires_at>?").bind(code,now()).first();
    if(!pairing)fail(404,'配对码无效、已使用或已过期。');return json({pairing});
  }
  if(request.method==='POST'&&path==='/api/pairing/approve'){
    sameOrigin(request);const value=await body(request);const project=await ownedProject(db,value.projectId,user.id);
    const code=text(value.code,20).toUpperCase().replace(/-/g,'');await rateLimit(db,'pair-approve:'+user.id,20,600);
    const result=await db.prepare("UPDATE pairings SET owner_id=?,project_id=?,status='approved' WHERE code=? AND status='pending' AND expires_at>?").bind(user.id,project.id,code,now()).run();
    if(!result.meta.changes)fail(404,'配对码无效、已使用或已过期。');return json({ok:true});
  }
  fail(404,'没有这个接口。');
}

export async function syncApi(request,env){
  if(request.method!=='POST')fail(405,'仅支持同步请求。');
  const db=env.DB,path=new URL(request.url).pathname,time=now();
  if(path==='/v1/pair/start'){
    await rateLimit(db,'pair-start:'+(request.headers.get('cf-connecting-ip')||'local'),12,3600);
    const input=await body(request);const deviceName=text(input.deviceName,120).trim()||'我的电脑';
    const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789',bytes=crypto.getRandomValues(new Uint8Array(12));
    const code=Array.from(bytes,b=>alphabet[b%alphabet.length]).join(''),pollSecret=randomToken();
    await db.prepare('INSERT INTO pairings(code,poll_hash,device_id,device_name,created_at,expires_at) VALUES(?,?,?,?,?,?)').bind(code,await digest(pollSecret),crypto.randomUUID(),deviceName,time,time+600).run();
    return json({code,pollSecret,expiresIn:600},201);
  }
  if(path==='/v1/pair/status'){
    const input=await body(request);const code=text(input.code,20),pollHash=await digest(text(input.pollSecret,128));
    await rateLimit(db,'pair-poll:'+code,150,600);
    const pair=await db.prepare('SELECT * FROM pairings WHERE code=? AND poll_hash=? AND expires_at>?').bind(code,pollHash,time).first();
    if(!pair)fail(404,'配对已过期或凭证不正确。');
    if(pair.status==='pending')return json({status:'pending'});
    if(pair.status!=='approved')fail(409,'配对已经完成，请重新发起配对。');
    const token=randomToken(),tokenHash=await digest(token),expires=time+90*86400;
    const results=await db.batch([
      db.prepare("INSERT OR IGNORE INTO devices(id,owner_id,project_id,name,token_hash,created_at,expires_at) SELECT device_id,owner_id,project_id,device_name,?,?,? FROM pairings WHERE code=? AND poll_hash=? AND status='approved' AND expires_at>?").bind(tokenHash,time,expires,code,pollHash,time),
      db.prepare("UPDATE pairings SET status='consumed' WHERE code=? AND status='approved'").bind(code)
    ]);
    if(results[0].meta.changes!==1)fail(409,'配对已被使用，请重新连接。');
    return json({status:'approved',token,deviceId:pair.device_id,projectId:pair.project_id,expiresAt:iso(expires)});
  }
  if(path==='/v1/snapshot'){
    const bearer=request.headers.get('authorization')||'';
    if(!/^Bearer [a-f0-9]{64}$/.test(bearer))fail(401,'同步凭证无效。');
    const device=await db.prepare('SELECT id,owner_id,project_id FROM devices WHERE token_hash=? AND revoked_at IS NULL AND expires_at>?').bind(await digest(bearer.slice(7)),time).first();
    if(!device)fail(401,'设备已撤销或凭证过期，请重新连接。');
    await rateLimit(db,'upload:'+device.id,30,60);
    const input=await body(request);if(!Number.isSafeInteger(input.sequence)||input.sequence<1)fail(400,'同步序号不正确。');
    const normalized=snapshot(input.snapshot),serialized=JSON.stringify(normalized);
    const existing=await db.prepare('SELECT device_id,sequence FROM snapshots WHERE project_id=?').bind(device.project_id).first();
    if(existing&&existing.device_id!==device.id){
      const source=await db.prepare('SELECT revoked_at,expires_at FROM devices WHERE id=?').bind(existing.device_id).first();
      if(source&&!source.revoked_at&&source.expires_at>time)fail(409,'此项目已由另一台设备同步，请先在网站撤销旧设备，或新建项目。');
    }
    const result=await db.batch([
      db.prepare('INSERT INTO snapshots(project_id,device_id,body,received_at,sequence) SELECT project_id,id,?,?,? FROM devices WHERE id=? AND revoked_at IS NULL AND expires_at>? ON CONFLICT(project_id) DO UPDATE SET device_id=excluded.device_id,body=excluded.body,received_at=excluded.received_at,sequence=excluded.sequence WHERE (snapshots.device_id=excluded.device_id AND excluded.sequence>=snapshots.sequence) OR (snapshots.device_id<>excluded.device_id AND NOT EXISTS(SELECT 1 FROM devices old WHERE old.id=snapshots.device_id AND old.revoked_at IS NULL AND old.expires_at>?))').bind(serialized,time,input.sequence,device.id,time,time),
      db.prepare('UPDATE devices SET last_seen_at=? WHERE id=? AND revoked_at IS NULL').bind(time,device.id)
    ]);
    if(!result[0].meta.changes)fail(409,'收到过期同步数据，请重新启动同步程序。');
    return json({ok:true,receivedAt:iso(time),projectId:device.project_id});
  }
  fail(404,'没有这个同步接口。');
}

export default {
  async fetch(request,env){
    try {
      if(env.SERVICE_MODE==='sync')return secured(await syncApi(request,env));
      if(env.SERVICE_MODE!=='web')fail(503,'服务尚未配置。');
      const path=new URL(request.url).pathname;
      if(env.AUTH_MODE==='password'){
        if(path.startsWith('/api/auth/'))return secured(await authApi(request,env));
        if(['/login','/login/','/auth.js','/portal.css','/favicon.svg'].includes(path)&&['GET','HEAD'].includes(request.method)){
          return secured(await env.ASSETS.fetch(request));
        }
      }
      let user;
      try {user=await identity(request,env)}catch(error){
        if(env.AUTH_MODE==='password'&&error.status===401&&!path.startsWith('/api/')&&['GET','HEAD'].includes(request.method)){
          const target=new URL(request.url);return secured(new Response(null,{status:302,headers:{Location:'/login?next='+encodeURIComponent(target.pathname+target.search)}}));
        }
        throw error;
      }
      if(path.startsWith('/api/'))return secured(await webApi(request,env,user));
      if(request.method!=='GET'&&request.method!=='HEAD')fail(405,'不支持此操作。');
      if(!env.ASSETS)fail(503,'页面尚未构建。');
      return secured(await env.ASSETS.fetch(request));
    } catch(error){
      const expected=error instanceof HttpError||error instanceof AuthError;
      return secured(json({error:expected?error.message:'服务暂时不可用，请稍后重试。'},expected?error.status:500));
    }
  },
  async scheduled(event,env){await env.DB.batch([env.DB.prepare('DELETE FROM pairings WHERE expires_at<?').bind(now()-86400),env.DB.prepare('DELETE FROM rate_limits WHERE expires_at<?').bind(now()-86400),env.DB.prepare('DELETE FROM sessions WHERE expires_at<?').bind(now()),env.DB.prepare('DELETE FROM invitations WHERE expires_at<?').bind(now())])}
};
