const $=id=>document.getElementById(id);
const safe=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const time=epoch=>epoch?new Date(epoch*1000).toLocaleString('zh-CN'):'尚未同步';
let code=new URLSearchParams(location.search).get('pair');
let projects=[];
let deviceProject=null;
function notice(message){$('notice').hidden=!message;$('notice').textContent=message}
async function api(path,method='GET',value){const response=await fetch(path,{method,headers:value?{'Content-Type':'application/json'}:{},body:value?JSON.stringify(value):undefined,cache:'no-store'});if(response.status===401){location.replace('/login?next='+encodeURIComponent(location.pathname+location.search));throw Error('请重新登录。')}const data=await response.json();if(!response.ok)throw Error(data.error||'请求失败');return data}
async function load(){
  const [me,list]=await Promise.all([api('/api/me'),api('/api/projects')]);projects=list.projects;
  $('account').textContent=me.email;
  $('projects').innerHTML=projects.map(p=>`<article class="project"><span class="state ${p.online?'online':''}">${p.online?'● 本机正在同步':p.received_at?'○ 本机离线，保留上次记录':'○ 等待连接电脑'}</span><h3>${safe(p.name)}</h3><p>最近收到数据：${safe(time(p.received_at))}</p><div class="actions"><a href="/dashboard/?project=${encodeURIComponent(p.id)}#/overview">进入看板 →</a><button data-devices="${safe(p.id)}">管理电脑</button></div></article>`).join('')||'<p class="hint">先新建一个项目，再连接你的电脑。</p>';
  const previousProject=$('pair-project').value;
  $('pair-project').innerHTML=projects.map(p=>`<option value="${safe(p.id)}">${safe(p.name)}</option>`).join('');
  if(projects.some(p=>p.id===previousProject))$('pair-project').value=previousProject;
  if(code){const {pairing}=await api('/api/pairing?code='+encodeURIComponent(code));$('pair-panel').hidden=false;$('pair-description').textContent=`设备名称：${pairing.device_name}。配对码：${pairing.code}，有效至 ${time(pairing.expires_at)}。`;$('approve').disabled=!projects.length;}
}
async function devices(id){deviceProject=id;const {devices}=await api('/api/devices?project='+encodeURIComponent(id));$('devices-panel').hidden=false;$('devices-title').textContent=(projects.find(p=>p.id===id)?.name||'项目')+' · 连接的电脑';$('devices').innerHTML=devices.map(d=>`<div class="device"><div><b>${safe(d.name)}</b><p>${d.revoked_at?'已撤销':Date.now()/1000>d.expires_at?'已过期':'有效'} · 最后同步 ${safe(time(d.last_seen_at))}</p></div>${d.revoked_at?'':`<button data-revoke="${safe(d.id)}">撤销连接</button>`}</div>`).join('')||'<p class="hint">还没有设备。请在你的电脑上运行同步程序并配对。</p>'}
$('create-project').addEventListener('submit',async event=>{event.preventDefault();const button=event.target.querySelector('button');button.disabled=true;try{await api('/api/projects','POST',{name:$('project-name').value});$('project-name').value='';notice('项目已创建。');await load()}catch(e){notice(e.message)}finally{button.disabled=false}});
$('approve').addEventListener('click',async()=>{$('approve').disabled=true;try{await api('/api/pairing/approve','POST',{code,projectId:$('pair-project').value});code=null;$('pair-panel').hidden=true;notice('已允许连接。回到本机运行同步程序即可。');history.replaceState(null,'','/');}catch(e){notice(e.message);$('approve').disabled=false}});
$('refresh').addEventListener('click',()=>load().catch(e=>notice(e.message)));
$('close-devices').addEventListener('click',()=>{$('devices-panel').hidden=true});
$('projects').addEventListener('click',event=>{const button=event.target.closest('[data-devices]');if(button)devices(button.dataset.devices).catch(e=>notice(e.message))});
$('devices').addEventListener('click',async event=>{const button=event.target.closest('[data-revoke]');if(!button||!confirm('撤销后，这台电脑将不能继续上传此项目。确认撤销？'))return;button.disabled=true;try{await api('/api/devices/revoke','POST',{id:button.dataset.revoke});await devices(deviceProject)}catch(e){notice(e.message);button.disabled=false}});
$('logout').addEventListener('click',async()=>{try{await api('/api/auth/logout','POST',{});location.replace('/login')}catch(error){notice(error.message)}});
load().catch(e=>notice(e.message));
setInterval(()=>{if(!document.hidden)load().catch(e=>notice(e.message))},15000);
