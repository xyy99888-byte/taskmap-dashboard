const timelineState={mode:'schedule',scale:'day',anchor:null,project:null,lane:'',status:'all'};
const DAY_MS=86400000;
function dateDay(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;
  const n=Date.parse(value+'T00:00:00Z');
  return Number.isFinite(n)&&new Date(n).toISOString().slice(0,10)===value?Math.floor(n/DAY_MS):null;
}
function dayISO(n){return new Date(n*DAY_MS).toISOString().slice(0,10)}
function projectDay(value){
  try {return new Intl.DateTimeFormat('en-CA',{timeZone:current?.timezone||'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));}
  catch {return new Date(value).toISOString().slice(0,10)}
}
function timelineLink(t){return pageHash(t.laneId,{window:t.windowId,task:t.id})}
function timelineTaskRows(){return windowsOf(current).flatMap(w=>w.tasks.map(t=>({...t,laneId:w.laneId,lane:w.lane,windowId:w.id,window:w.title}))).filter(t=>t.status!=='cancelled');}
function timelineMatches(t){return (!timelineState.lane||t.laneId===timelineState.lane)&&(timelineState.status==='all'||(timelineState.status==='done'?t.status==='done':t.status!=='done'&&t.status!=='cancelled'));}
function renderTimeline(){
  if(!current)return;
  const today=dateDay(projectDay(Date.now()));
  const project=current.projectId||current.project;
  if(timelineState.project!==project){timelineState.project=project;timelineState.anchor=today-3;timelineState.lane='';timelineState.status='all';$('timeline-status').value='all';}
  setMarkup('timeline-lane','<option value="">全部模块</option>'+current.lanes.map(l=>`<option value="${safe(l.id)}">${safe(l.title)}</option>`).join(''));
  if(!current.lanes.some(l=>l.id===timelineState.lane))timelineState.lane='';
  $('timeline-lane').value=timelineState.lane;
  $('timeline-range-controls').hidden=timelineState.mode!=='schedule';
  document.querySelectorAll('[data-timeline-mode]').forEach(b=>{const active=b.dataset.timelineMode===timelineState.mode;b.classList.toggle('selected',active);b.setAttribute('aria-pressed',String(active));});
  if(timelineState.mode==='history')renderTimelineHistory();else renderSchedule(today);
}
function renderSchedule(today){
  const tasks=timelineTaskRows().filter(timelineMatches),days=timelineState.scale==='day'?14:84,start=timelineState.anchor,end=start+days-1;
  const step=timelineState.scale==='day'?1:7;
  const scheduled=[],undated=[];
  for(const t of tasks){
    const a=dateDay(t.startsOn),b=dateDay(t.dueOn);
    if(t.scheduleWarning||(a===null&&b===null)||(a!==null&&b!==null&&a>b)){undated.push(t);continue;}
    scheduled.push({...t,from:a??b,to:b??a,partial:a===null?'仅截止':b===null?'仅开始':''});
  }
  scheduled.sort((a,b)=>a.from-b.from||a.to-b.to);
  const visible=scheduled.filter(t=>t.to>=start&&t.from<=end);
  const outside=scheduled.length-visible.length;
  $('timeline-note').textContent=`${dayISO(start)} — ${dayISO(end)} · ${scheduled.length} 项有日期 · ${undated.length} 项待排期或待核对${outside?' · '+outside+' 项在当前时间范围外':''}。今天按项目时区 ${current.timezone||'Asia/Shanghai'} 标记。`;
  const ticks=Array.from({length:days/step},(_,i)=>{const day=start+i*step;return `<span>${dayISO(day).slice(5)}${step===7?' 起':''}</span>`;}).join('');
  const todayLine=today>=start&&today<=end?`<span class="timeline-today-line" data-left="${(today-start+0.5)/days*100}" title="今天 ${dayISO(today)}"><b>今天</b></span>`:'';
  const groups=current.lanes.map(l=>{
    const items=visible.filter(t=>t.laneId===l.id);if(!items.length)return '';
    return `<div class="timeline-module">${safe(l.title)} <span>${items.filter(t=>t.status==='done').length} / ${items.length} 项完成（当前范围）</span></div>`+items.map(t=>{
      const left=(Math.max(t.from,start)-start)/days*100,width=(Math.min(t.to,end)-Math.max(t.from,start)+1)/days*100;
      const overdue=t.status!=='done'&&dateDay(t.dueOn)!==null&&dateDay(t.dueOn)<today;
      const caption=`${t.startsOn||'开始未定'} → ${t.dueOn||'截止未定'}`;
      return `<div class="timeline-task-row"><a class="timeline-task-label" href="${safe(timelineLink(t))}"><strong>${safe(t.title)}</strong><small>${safe(t.window)} · ${safe(caption)}${t.partial?' · '+t.partial:''}${overdue?' · 已逾期':''}</small></a><div class="timeline-plot">${todayLine}<a class="timeline-bar ${safe(t.status)}${overdue?' overdue':''}${t.partial?' partial':''}" data-left="${left}" data-width="${width}" href="${safe(timelineLink(t))}" aria-label="${safe(t.title+'，'+stateNames[t.status]+'，'+caption+(overdue?'，已逾期':''))}" title="${safe(t.title+' · '+stateNames[t.status]+' · '+caption)}"><span>${safe(stateNames[t.status])}</span></a></div></div>`;
    }).join('');
  }).join('');
  const jump=scheduled.length?`<button type="button" data-jump-day="${scheduled[0].from}">查看最早排期 →</button>`:'';
  const chart=visible.length?`<div class="timeline-scroll" tabindex="0" aria-label="任务排期，横向滚动查看日期"><div class="timeline-chart" data-ticks="${days/step}"><div class="timeline-axis"><span>模块 / 任务</span><div class="timeline-ticks">${ticks}</div></div>${groups}</div></div>`:`<div class="timeline-empty"><strong>${scheduled.length?'当前时间范围没有任务排期':'尚未记录任务排期'}</strong><p>${scheduled.length?'可切换时间范围，或跳到最早一项。':'在任务记录中补充计划开始、截止日期后，横向时间条会自动出现。'}</p>${jump}</div>`;
  const pending=undated.length?`<details class="timeline-undated" open><summary>待排期 / 日期待核对 · ${undated.length} 项</summary><div class="timeline-undated-list">${undated.map(t=>`<a href="${safe(timelineLink(t))}"><span class="task-status ${safe(t.status)}">${safe(stateNames[t.status])}</span><span><b>${safe(t.title)}</b><small>${safe(t.lane+' · '+t.window)}${t.scheduleWarning?' · '+safe(t.scheduleWarning):''}</small></span><span aria-hidden="true">↗</span></a>`).join('')}</div></details>`:'';
  setMarkup('timeline-content',`<div class="timeline-legend"><span>横条：计划起止</span><span>虚线条：只记录一个日期</span><span>红色边框：逾期未完成</span>${visible.length&&outside?jump:''}</div>${chart}${pending}${!tasks.length?'<p class="empty-state">当前筛选下没有任务。</p>':''}`);
  document.querySelectorAll('#timeline-content [data-left]').forEach(el=>el.style.left=Number(el.dataset.left)+'%');
  document.querySelectorAll('#timeline-content [data-width]').forEach(el=>el.style.width=Number(el.dataset.width)+'%');
  document.querySelectorAll('#timeline-content [data-ticks]').forEach(el=>el.style.setProperty('--ticks',el.dataset.ticks));
}
function renderTimelineHistory(){
  const h=current.history||{};
  $('timeline-note').textContent=h.error?'历史记录暂时不可用；稍后自动重试。':h.startedAt?`从 ${fmt(h.startedAt)} 开始记录 · 最近 ${h.limit||200} 条 · 已有完成项仅作为起始快照，不计作当天新完成。`:'等待本机同步历史记录。旧快照没有历史，连接新版同步程序后开始积累。';
  const events=(h.events||[]).filter(e=>e.kind==='baseline'?!timelineState.lane&&timelineState.status==='all':timelineMatches(e)).slice().sort((a,b)=>Date.parse(b.observedAt)-Date.parse(a.observedAt)||Number(b.id)-Number(a.id));
  const groups=new Map();events.forEach(e=>{const day=projectDay(e.observedAt);if(!groups.has(day))groups.set(day,[]);groups.get(day).push(e)});
  const names={baseline:'建立起始快照',added:'发现新增任务',removed:'任务移出清单',schedule:'日期记录变更'};
  const html=[...groups].map(([day,items])=>{
    const last=items[0],completion=items.filter(e=>e.kind==='status'&&e.status==='done').length;
    return `<section class="timeline-day"><div class="timeline-day-heading"><h3>${safe(day)}</h3><span>本组记录到完成 ${completion} 项 · 当日最后一条可见记录：全项目 ${last.done} / ${last.total} 项完成，还剩 ${last.total-last.done} 项</span></div><ol class="timeline-events">${items.map(e=>{
      const action=e.kind==='status'?`${stateNames[e.previousStatus]||'未知'} → ${stateNames[e.status]||'未知'}`:names[e.kind];
      const link=e.taskId?taskLink(e.taskId):null;
      return `<li><time>${safe(fmt(e.observedAt))}</time><div><span class="timeline-event-type">${safe(action)}</span>${e.kind==='baseline'?'<strong>开始保存项目历史</strong><p>这是当时已有状态，不能据此确定各任务的实际完成时间。</p>':`${link?`<a href="${safe(link)}">${safe(e.title)} ↗</a>`:`<strong>${safe(e.title)}</strong>`}<p>${safe((e.lane||'')+' · '+(e.window||''))}${e.completedAt?' · 记录的实际完成：'+safe(fmt(e.completedAt)):''}${e.kind==='schedule'?' · 计划 '+safe(e.startsOn||'未定')+' → '+safe(e.dueOn||'未定'):''}</p>`}</div></li>`;
    }).join('')}</ol></section>`;
  }).join('');
  setMarkup('timeline-content',html||'<div class="timeline-empty">当前没有符合条件的历史记录。后续观测到的新增、状态变化、日期变更和移出事项会出现在这里。</div>');
}
document.querySelectorAll('[data-timeline-mode]').forEach(b=>b.addEventListener('click',()=>{timelineState.mode=b.dataset.timelineMode;renderTimeline()}));
for(const [id,key] of [['timeline-lane','lane'],['timeline-status','status'],['timeline-scale','scale']])$(id).addEventListener('change',()=>{timelineState[key]=$(id).value;renderTimeline()});
$('timeline-prev').addEventListener('click',()=>{timelineState.anchor-=timelineState.scale==='day'?14:84;renderTimeline()});
$('timeline-next').addEventListener('click',()=>{timelineState.anchor+=timelineState.scale==='day'?14:84;renderTimeline()});
$('timeline-today').addEventListener('click',()=>{timelineState.anchor=dateDay(projectDay(Date.now()))-3;renderTimeline()});
$('timeline-content').addEventListener('click',e=>{const b=e.target.closest('[data-jump-day]');if(b){timelineState.anchor=Number(b.dataset.jumpDay)-1;renderTimeline()}});
if(current)renderTimeline();
