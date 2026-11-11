const $=id=>document.getElementById(id);
const safe=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const time=epoch=>epoch?new Date(epoch*1000).toLocaleString('zh-CN'):'尚未同步';
let code=new URLSearchParams(location.search).get('pair');
let projects=[];
let deviceProject=null,deviceRequest=0,loading=null,pairingBusy=false;
function busy(button,value,label){if(value){button.dataset.label=button.textContent;button.textContent=label;button.disabled=true;button.setAttribute('aria-busy','true')}else{button.textContent=button.dataset.label||button.textContent;button.disabled=false;button.removeAttribute('aria-busy')}}
function notice(message){$('notice').hidden=!message;$('notice').textContent=message}
async function api(path,method='GET',value){const response=await fetch(path,{method,headers:value?{'Content-Type':'application/json'}:{},body:value?JSON.stringify(value):undefined,cache:'no-store',signal:AbortSignal.timeout(15000)});if(response.status===401){location.replace('/login?next='+encodeURIComponent(location.pathname+location.search));throw Error('请重新登录。')}const data=await response.json();if(!response.ok)throw Error(data.error||'请求失败');return data}
function load(){
  if(loading)return loading;
  busy($('refresh'),true,'刷新中…');
  loading=loadProjects().catch(error=>{if(!projects.length)$('projects').innerHTML='<p class="hint">暂时无法加载项目，请点击刷新重试。</p>';throw error;}).finally(()=>{loading=null;busy($('refresh'),false)});return loading;
}
async function loadProjects(){
  const [me,list]=await Promise.all([api('/api/me'),api('/api/projects')]);projects=list.projects;
  $('account').textContent=me.email;
  const markup=projects.map(p=>`<article class="project"><span class="state ${p.online?'online':''}">${p.online?'● 本机正在同步':p.received_at?'○ 本机离线，保留上次记录':'○ 等待连接电脑'}</span><h3>${safe(p.name)}</h3><p>最近收到数据：${safe(time(p.received_at))}</p><div class="actions"><a href="/dashboard/?project=${encodeURIComponent(p.id)}#/overview">进入看板 →</a><button data-devices="${safe(p.id)}">管理电脑</button></div></article>`).join('')||'<p class="hint">先新建一个项目，再连接你的电脑。</p>';
  if($('projects').dataset.markup!==markup){const focused=document.activeElement.dataset?.devices;$('projects').innerHTML=markup;$('projects').dataset.markup=markup;if(focused)[...$('projects').querySelectorAll('[data-devices]')].find(b=>b.dataset.devices===focused)?.focus({preventScroll:true});}
  const previousProject=$('pair-project').value;
  $('pair-project').innerHTML=projects.map(p=>`<option value="${safe(p.id)}">${safe(p.name)}</option>`).join('');
  if(projects.some(p=>p.id===previousProject))$('pair-project').value=previousProject;
  if(code){const {pairing}=await api('/api/pairing?code='+encodeURIComponent(code));$('pair-panel').hidden=false;$('pair-description').textContent=`设备名称：${pairing.device_name}。配对码：${pairing.code}，有效至 ${time(pairing.expires_at)}。`;$('approve').disabled=pairingBusy||!projects.length;}
}
async function devices(id){
  deviceProject=id;const request=++deviceRequest;
  $('devices-title').textContent=(projects.find(p=>p.id===id)?.name||'项目')+' · 连接的电脑';
  $('devices').textContent='正在读取设备…';if(!$('devices-panel').open)$('devices-panel').showModal();
  try{const {devices}=await api('/api/devices?project='+encodeURIComponent(id));
    if(request!==deviceRequest||!$('devices-panel').open)return;
    $('devices').innerHTML=devices.map(d=>`<div class="device"><div><b>${safe(d.name)}</b><p>${d.revoked_at?'已撤销':Date.now()/1000>d.expires_at?'已过期':'有效'} · 最后同步 ${safe(time(d.last_seen_at))}</p></div>${d.revoked_at?'':`<button data-revoke="${safe(d.id)}">撤销连接</button>`}</div>`).join('')||'<p class="hint">还没有设备。请在你的电脑上运行同步程序并配对。</p>';
  }catch(e){if(request===deviceRequest&&$('devices-panel').open){$('devices').textContent=e.message;const retry=document.createElement('button');retry.textContent='重新加载';retry.onclick=()=>devices(id);$('devices').append(retry);}}
}
$('create-project').addEventListener('submit',async event=>{
  event.preventDefault();const button=event.target.querySelector('button');if(button.disabled)return;
  const input=$('project-name'),name=input.value.trim();if(!name){input.setCustomValidity('请输入项目名称');input.reportValidity();return;}
  busy(button,true,'创建中…');input.disabled=true;
  try{await api('/api/projects','POST',{name});input.value='';notice('项目已创建，可以进入看板或连接电脑。');if(loading)await loading;await load();}
  catch(e){notice(e.message)}finally{busy(button,false);input.disabled=false;input.focus();}
});
$('project-name').addEventListener('input',()=>{$('project-name').setCustomValidity('')});
$('approve').addEventListener('click',async()=>{
  if(pairingBusy)return;pairingBusy=true;busy($('approve'),true,'连接中…');$('pair-project').disabled=true;
  try{await api('/api/pairing/approve','POST',{code,projectId:$('pair-project').value});code=null;$('pair-panel').hidden=true;notice('已允许连接。回到本机运行同步程序即可。');history.replaceState(null,'','/');}
  catch(e){notice(e.message)}finally{pairingBusy=false;busy($('approve'),false);$('pair-project').disabled=false;}
});
$('refresh').addEventListener('click',()=>load().catch(e=>notice(e.message)));
$('close-devices').addEventListener('click',()=>{$('devices-panel').close();deviceRequest++});
$('projects').addEventListener('click',event=>{const button=event.target.closest('[data-devices]');if(button)devices(button.dataset.devices).catch(e=>notice(e.message))});
$('devices').addEventListener('click',async event=>{const button=event.target.closest('[data-revoke]');if(!button||button.disabled||!confirm('撤销后，这台电脑将不能继续上传此项目。确认撤销？'))return;const project=deviceProject,request=deviceRequest;busy(button,true,'撤销中…');try{await api('/api/devices/revoke','POST',{id:button.dataset.revoke});if($('devices-panel').open&&request===deviceRequest)await devices(project)}catch(e){notice(e.message);busy(button,false)}});
$('logout').addEventListener('click',async()=>{if($('logout').disabled)return;busy($('logout'),true,'退出中…');try{await api('/api/auth/logout','POST',{});location.replace('/login')}catch(error){notice(error.message);busy($('logout'),false)}});
load().catch(e=>notice(e.message));
setInterval(()=>{if(!document.hidden&&!$('devices-panel').open&&!pairingBusy&&!document.activeElement.closest('form'))load().catch(e=>notice(e.message))},15000);

const mobile=matchMedia('(max-width: 900px)');
function closeNav(focus=false){document.body.classList.remove('nav-open');$('nav-backdrop').hidden=true;$('nav-toggle').setAttribute('aria-expanded','false');$('app-sidebar').inert=mobile.matches;$('main-content').inert=false;if(focus)$('nav-toggle').focus();}
$('nav-toggle').onclick=()=>{document.body.classList.add('nav-open');$('nav-backdrop').hidden=false;$('nav-toggle').setAttribute('aria-expanded','true');$('app-sidebar').inert=false;$('main-content').inert=true;$('nav-close').focus();};
$('nav-close').onclick=()=>closeNav(true);$('nav-backdrop').onclick=()=>closeNav(true);mobile.addEventListener('change',()=>closeNav());
$('app-sidebar').addEventListener('click',e=>{if(e.target.closest('a[href^="#"]'))closeNav()});
document.addEventListener('keydown',e=>{if(!document.body.classList.contains('nav-open'))return;if(e.key==='Escape'){e.preventDefault();closeNav(true);}if(e.key==='Tab'){const items=[...$('app-sidebar').querySelectorAll('a,button')].filter(el=>el.getClientRects().length);if(e.shiftKey&&document.activeElement===items[0]){e.preventDefault();items.at(-1).focus();}else if(!e.shiftKey&&document.activeElement===items.at(-1)){e.preventDefault();items[0].focus();}}});
closeNav();
