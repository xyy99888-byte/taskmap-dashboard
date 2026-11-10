const $=id=>document.getElementById(id);
const params=new URLSearchParams(location.search),fragment=new URLSearchParams(location.hash.slice(1));
let invite=fragment.get('invite')||'';
let mode=invite?'register':['register','recover','password'].includes(params.get('mode'))?params.get('mode'):'login';
let recoveryCode='';
// Keep the fragment until registration succeeds so refresh and browser handoff
// preserve the invitation. URL fragments are not sent to the server.
if(invite){const url=new URL(location.href);url.searchParams.set('mode','register');history.replaceState(null,'',url)}
const next=(()=>{try{const url=new URL(params.get('next')||'/',location.origin);return url.origin===location.origin&&!url.pathname.startsWith('/login')?url.pathname+url.search+url.hash:'/'}catch{return '/'}})();
function message(value){$('auth-notice').hidden=!value;$('auth-notice').textContent=value}
const labels={login:['登录你的看板','登录'],register:['创建你的看板账号','创建账号'],recover:['恢复账号','重设密码'],password:['修改密码','保存新密码']};
$('auth-title').textContent=labels[mode][0];$('submit').textContent=labels[mode][1];
document.title=labels[mode][0]+' · 项目进度看板';
$('invite-label').hidden=mode!=='register'||!!invite;$('invite-input').required=mode==='register'&&!invite;
$('auth-description').textContent=mode==='register'?'用至少 14 个字符的密码创建独立账号。无需使用 Cloudflare 账号。':mode==='recover'?'使用保存的恢复码重设密码。原有登录和电脑连接会被撤销。':mode==='password'?'修改后其他浏览器需要重新登录，已配对电脑仍可同步。':'查看自己的项目、窗口待办与最新进度。';
$('recovery-label').hidden=mode!=='recover';$('recovery-input').required=mode==='recover';
$('current-label').hidden=mode!=='password';$('current-password').required=mode==='password';
$('username-label').hidden=mode==='password';$('username').required=mode!=='password';
$('confirm-label').hidden=mode==='login';$('confirm-password').required=mode!=='login';
if(mode!=='login'){$('password').autocomplete='new-password';$('password-label').textContent=mode==='register'?'密码（至少 14 个字符）':'新密码（至少 14 个字符）';$('auth-links').innerHTML='<a href="/login">返回登录</a>'}
$('auth-form').addEventListener('submit',async event=>{
  event.preventDefault();message('');
  if(mode==='register'&&!$('invite-label').hidden){
    const value=$('invite-input').value.trim();
    try{invite=/^[a-f0-9]{64}$/.test(value)?value:new URLSearchParams(new URL(value).hash.slice(1)).get('invite')||''}catch{invite=''}
    if(!/^[a-f0-9]{64}$/.test(invite)){invite='';message('请粘贴完整邀请链接或 64 位邀请码。');return}
  }
  const pass=$('password').value;
  if(mode!=='login'&&[/\p{L}/u,/\p{N}/u,/[\p{P}\p{S}]/u].filter(pattern=>pattern.test(pass)).length<2){message('密码必须包含字母、数字、符号中的至少两类；空格不计作符号。');return}
  if(mode!=='login'&&pass!==$('confirm-password').value){message('两次输入的密码不一致。');return}
  $('submit').disabled=true;
  try{
    const response=await fetch('/api/auth/'+mode,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:$('username').value,password:pass,currentPassword:$('current-password').value,invite,recoveryCode:$('recovery-input').value.trim()})});
    const result=await response.json();if(!response.ok)throw Error(result.error||'操作失败，请重试。');
    $('password').value='';$('current-password').value='';$('confirm-password').value='';$('recovery-input').value='';invite='';
    $('invite-input').value='';history.replaceState(null,'',location.pathname+location.search);
    if(result.recoveryCode){recoveryCode=result.recoveryCode;$('auth-form').hidden=true;$('auth-links').hidden=true;$('recovery-result').hidden=false;$('recovery-output').textContent=recoveryCode}
    else location.replace(next);
  }catch(error){message(error.message)}finally{$('submit').disabled=false}
});
$('saved').addEventListener('change',()=>{$('continue').disabled=!$('saved').checked});
$('continue').addEventListener('click',()=>{if($('saved').checked)location.replace(next)});
$('save-recovery').addEventListener('click',()=>{
  const file=new Blob([`项目进度看板账号恢复码\n网站：${location.origin}\n用户名：${$('username').value.trim().toLowerCase()}\n恢复码：${recoveryCode}\n请勿分享。恢复账号后此码会被替换。\n`],{type:'text/plain;charset=utf-8'});
  const url=URL.createObjectURL(file),link=document.createElement('a');link.href=url;link.download='项目看板-账号恢复码.txt';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
