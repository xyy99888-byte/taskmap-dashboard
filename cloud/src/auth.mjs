// Invitation-only accounts. No email provider or external identity service required.
const encoder=new TextEncoder();
const COOKIE='__Host-progress-session';
const TTL=7*86400;
// Workers WebCrypto supports at most 100,000 PBKDF2 iterations.
const ITERATIONS=100000;
export class AuthError extends Error {constructor(status,message){super(message);this.status=status}}
const fail=(status,message)=>{throw new AuthError(status,message)};
const now=()=>Math.floor(Date.now()/1000);
const hex=bytes=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
const random=()=>hex(crypto.getRandomValues(new Uint8Array(32)));
export const hash=async value=>hex(await crypto.subtle.digest('SHA-256',encoder.encode(value)));
function equal(a,b){if(a.length!==b.length)return false;let difference=0;for(let i=0;i<a.length;i++)difference|=a.charCodeAt(i)^b.charCodeAt(i);return difference===0}
export async function passwordHash(password,salt=random()){
  const key=await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveBits']);
  const value=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:encoder.encode(salt),iterations:ITERATIONS},key,256);
  return `pbkdf2-sha256$${ITERATIONS}$${salt}$${hex(value)}`;
}
async function verify(password,record){
  const parts=record.split('$');
  if(parts.length!==4||parts[0]!=='pbkdf2-sha256'||Number(parts[1])!==ITERATIONS)return false;
  return equal(await passwordHash(password,parts[2]),record);
}
function username(value){if(typeof value!=='string')fail(400,'请填写用户名。');const result=value.trim().toLowerCase();if(!/^[a-z0-9][a-z0-9_-]{2,31}$/.test(result))fail(400,'用户名需为 3–32 位英文字母、数字、下划线或短横线。');return result}
function password(value,checkComposition=false){
  if(typeof value!=='string'||value.length<14||value.length>128)fail(400,'密码需为 14–128 个字符。');
  if(checkComposition&&[/\p{L}/u,/\p{N}/u,/[\p{P}\p{S}]/u].filter(pattern=>pattern.test(value)).length<2)fail(400,'密码必须包含字母、数字、符号中的至少两类；空格不计作符号。');
  return value;
}
function json(value,status=200,cookie){const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'};if(cookie)headers['Set-Cookie']=cookie;return new Response(JSON.stringify(value),{status,headers})}
function cookie(token,age=TTL){return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`}
function sessionToken(request){const match=(request.headers.get('cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE+'='));const value=match?.slice(COOKIE.length+1)||'';return /^[a-f0-9]{64}$/.test(value)?value:null}
async function issue(db,id,record){const token=random(),time=now();const result=await db.prepare('INSERT INTO sessions(token_hash,account_id,credential_hash,created_at,expires_at) SELECT ?,id,password_hash,?,? FROM accounts WHERE id=? AND password_hash=?').bind(await hash(token),time,time+TTL,id,record).run();if(result.meta.changes!==1)fail(409,'账号已更新，请重新登录。');return cookie(token)}
export async function nativeIdentity(request,env){
  const token=sessionToken(request);if(!token)fail(401,'请先登录。');
  const account=await env.DB.prepare('SELECT a.id,a.username FROM sessions s JOIN accounts a ON a.id=s.account_id WHERE s.token_hash=? AND s.expires_at>? AND s.credential_hash=a.password_hash').bind(await hash(token),now()).first();
  if(!account)fail(401,'登录已过期，请重新登录。');return {id:account.id,email:account.username};
}
async function limit(db,key,count,seconds){
  const time=now(),bucket=await hash('auth:'+key+':'+Math.floor(time/seconds));
  const result=await db.prepare('INSERT INTO rate_limits(bucket,count,expires_at) VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET count=count+1 RETURNING count').bind(bucket,time+seconds).first();
  if(result.count>count)fail(429,'尝试次数较多，请 15 分钟后再试。');
}
async function input(request){
  if(!request.headers.get('content-type')?.includes('application/json'))fail(415,'请使用 JSON 请求。');
  const reader=request.body?.getReader();if(!reader)fail(400,'缺少请求内容。');
  let size=0;const chunks=[];
  while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>8192){await reader.cancel();fail(413,'请求内容过长。')}chunks.push(value)}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
  try {const result=JSON.parse(new TextDecoder().decode(bytes));if(!result||typeof result!=='object'||Array.isArray(result))throw Error();return result}catch{fail(400,'请求格式不正确。')}
}
export async function authApi(request,env){
  const url=new URL(request.url),path=url.pathname,db=env.DB;
  if(request.method!=='POST')fail(405,'不支持此操作。');
  if(request.headers.get('origin')!==url.origin)fail(403,'请求来源不匹配，请从网站操作。');
  if(path==='/api/auth/logout'){
    const token=sessionToken(request);if(token)await db.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await hash(token)).run();return json({ok:true},200,cookie('',0));
  }
  if(!['/api/auth/login','/api/auth/register','/api/auth/recover','/api/auth/password'].includes(path))fail(404,'没有这个接口。');
  await limit(db,'ip:'+(request.headers.get('cf-connecting-ip')||'local'),30,900);
  const data=await input(request);
  if(path==='/api/auth/password'){
    const user=await nativeIdentity(request,env);await limit(db,'password:'+user.id,8,900);
    const current=password(data.currentPassword),next=password(data.password,true);
    const account=await db.prepare('SELECT password_hash FROM accounts WHERE id=?').bind(user.id).first();
    if(!await verify(current,account.password_hash))fail(401,'当前密码不正确。');
    const updated=await passwordHash(next);
    const results=await db.batch([
      db.prepare('DELETE FROM sessions WHERE account_id=? AND EXISTS(SELECT 1 FROM accounts WHERE id=? AND password_hash=?)').bind(user.id,user.id,account.password_hash),
      db.prepare('UPDATE accounts SET password_hash=? WHERE id=? AND password_hash=?').bind(updated,user.id,account.password_hash)
    ]);
    if(results[1].meta.changes!==1)fail(409,'账号已更新，请重新登录。');
    return json({ok:true},200,await issue(db,user.id,updated));
  }
  const name=username(data.username),pass=password(data.password,path!=='/api/auth/login');
  await limit(db,'account:'+name,10,900);
  if(path==='/api/auth/register'){
    if(typeof data.invite!=='string'||!/^[a-f0-9]{64}$/.test(data.invite))fail(400,'请通过有效的邀请链接创建账号。');
    const inviteHash=await hash(data.invite),time=now();
    if(!await db.prepare('SELECT token_hash FROM invitations WHERE token_hash=? AND used_by IS NULL AND expires_at>?').bind(inviteHash,time).first())fail(400,'邀请已使用或已过期。');
    const id=crypto.randomUUID(),record=await passwordHash(pass),recovery=random();
    let results;
    try {results=await db.batch([
      db.prepare('INSERT INTO accounts(id,username,password_hash,recovery_hash,created_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM invitations WHERE token_hash=? AND used_by IS NULL AND expires_at>?)').bind(id,name,record,await hash(recovery),time,inviteHash,time),
      db.prepare('UPDATE invitations SET used_by=? WHERE token_hash=? AND used_by IS NULL AND EXISTS(SELECT 1 FROM accounts WHERE id=?)').bind(id,inviteHash,id)
    ])}catch(error){if(String(error).includes('UNIQUE constraint failed: accounts.username'))fail(409,'用户名不可用，请换一个。');throw error}
    if(results[0].meta.changes!==1||results[1].meta.changes!==1)fail(400,'邀请已使用或已过期。');
    return json({ok:true,recoveryCode:recovery},201,await issue(db,id,record));
  }
  const account=await db.prepare('SELECT * FROM accounts WHERE username=?').bind(name).first();
  if(path==='/api/auth/login'){
    // Perform identical KDF work for unknown usernames; never store raw passwords.
    const valid=account?await verify(pass,account.password_hash):(await passwordHash(pass,'0'.repeat(64)),false);
    if(!valid)fail(401,'用户名或密码不正确。');return json({ok:true},200,await issue(db,account.id,account.password_hash));
  }
  const recovery=typeof data.recoveryCode==='string'?data.recoveryCode.trim():'';
  if(!/^[a-f0-9]{64}$/.test(recovery)||!account||!equal(await hash(recovery),account.recovery_hash))fail(401,'用户名或恢复码不正确。');
  const replacement=random(),record=await passwordHash(pass),old=account.recovery_hash;
  const results=await db.batch([
    db.prepare('DELETE FROM sessions WHERE account_id=? AND EXISTS(SELECT 1 FROM accounts WHERE id=? AND recovery_hash=?)').bind(account.id,account.id,old),
    db.prepare('UPDATE devices SET revoked_at=? WHERE owner_id=? AND revoked_at IS NULL AND EXISTS(SELECT 1 FROM accounts WHERE id=? AND recovery_hash=?)').bind(now(),account.id,account.id,old),
    db.prepare('UPDATE accounts SET password_hash=?,recovery_hash=? WHERE id=? AND recovery_hash=?').bind(record,await hash(replacement),account.id,old)
  ]);
  if(results[2].meta.changes!==1)fail(401,'恢复码已失效。');
  return json({ok:true,recoveryCode:replacement},200,await issue(db,account.id,record));
}
