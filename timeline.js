const timelineState={mode:'history',scale:'day',anchor:null,project:null,lane:'',status:'all',selected:null};
const DAY_MS=86400000;
const timelineDays=()=>({day:14,month:30,week:84}[timelineState.scale]||14);
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
  if(timelineState.project!==project){
    timelineState.project=project;timelineState.anchor=today-10;timelineState.lane='';timelineState.status='all';timelineState.selected=null;timelineState.mode='history';
    try {const preferred=localStorage.getItem('taskmap.timeline.mode.'+project);if(['history','schedule'].includes(preferred))timelineState.mode=preferred;}catch{}
    const recorded=TaskTimeline.entries(current).map(e=>dateDay(projectDay(e.at))).filter(n=>n!==null);
    const earliest=recorded.length?Math.min(...recorded):today;
    timelineState.scale=earliest<today-26?'week':earliest<today-10?'month':'day';
    timelineState.anchor=today-(timelineDays()-4);$('timeline-scale').value=timelineState.scale;
    $('timeline-status').value='all';
  }
  setMarkup('timeline-lane','<option value="">全部模块</option>'+current.lanes.map(l=>`<option value="${safe(l.id)}">${safe(l.title)}</option>`).join(''));
  if(!current.lanes.some(l=>l.id===timelineState.lane))timelineState.lane='';
  $('timeline-lane').value=timelineState.lane;
  $('timeline-scale').value=timelineState.scale;
  $('timeline-status').value=timelineState.status;
  $('timeline-status-control').hidden=timelineState.mode!=='schedule';
  const windows=windowsOf(current).filter(w=>!timelineState.lane||w.laneId===timelineState.lane);
  const tasks=windows.flatMap(w=>w.tasks).filter(t=>t.status!=='cancelled');
  const pending=tasks.filter(t=>t.status!=='done'),plans=TaskTimeline.scheduleGroups(pending);
  const reviewed=windows.filter(w=>TaskTimeline.day(w.reviewedAt,current.timezone)).length;
  setMarkup('timeline-summary',`<div><strong>${reviewed}<small> / ${windows.length}</small></strong><span>窗口有复核时间</span></div><div><strong>${tasks.filter(t=>t.status==='done').length}<small> / ${tasks.length}</small></strong><span>当前已记录任务完成</span></div><div><strong>${pending.length}</strong><span>待完成 · ${plans.pending.length} 项待定日期</span></div>`);
  document.querySelectorAll('[data-timeline-mode]').forEach(b=>{const active=b.dataset.timelineMode===timelineState.mode;b.classList.toggle('selected',active);b.setAttribute('aria-pressed',String(active));});
  if(timelineState.mode==='history')renderTimelineHistory();else renderSchedule(today);
}
function renderSchedule(today){
  const tasks=timelineTaskRows().filter(timelineMatches),days=timelineDays(),start=timelineState.anchor,end=start+days-1;
  const step=timelineState.scale==='week'?7:1;
  const classified=TaskTimeline.scheduleGroups(tasks),scheduled=[],undated=classified.pending,archived=classified.archived;
  for(const t of classified.scheduled){
    const a=dateDay(t.startsOn),b=dateDay(t.dueOn);
    scheduled.push({...t,from:a??b,to:b??a,partial:a===null?'仅截止':b===null?'仅开始':''});
  }
  scheduled.sort((a,b)=>a.from-b.from||a.to-b.to);
  const visible=scheduled.filter(t=>t.to>=start&&t.from<=end);
  const outside=scheduled.length-visible.length;
  $('timeline-note').textContent=`${dayISO(start)} — ${dayISO(end)} · ${scheduled.length} 项有计划日期 · ${undated.length} 项未完成且待定日期 · ${archived.length} 项已完成但未记排期${outside?' · '+outside+' 项在当前范围外':''}。`;
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
  const emptyRows=current.lanes.filter(l=>!timelineState.lane||l.id===timelineState.lane).map(l=>`<div class="timeline-task-row"><div class="timeline-task-label"><strong>${safe(l.title)}</strong><small>未完成且待定日期：${undated.filter(t=>t.laneId===l.id).length} 项</small></div><div class="timeline-plot">${todayLine}<span class="timeline-no-record">${scheduled.some(t=>t.laneId===l.id)?'计划日期在其他范围':'计划日期待确认'}</span></div></div>`).join('');
  const chart=`${!visible.length?`<div class="timeline-plan-help"><strong>${scheduled.length?'当前范围没有排期':'计划日期尚未确定'}</strong><span>${scheduled.length?'可切换时间范围或定位最早排期。':'先确认未完成事项的起止日期；已有复核记录可在“进展轨迹”中查看。'}</span>${jump||'<button type="button" data-open-history>查看已有进展 →</button>'}</div>`:''}<div class="timeline-scroll" tabindex="0" aria-label="任务排期，横向滚动查看日期"><div class="timeline-chart" data-ticks="${days/step}"><div class="timeline-axis"><span>模块 / 任务</span><div class="timeline-ticks">${ticks}</div></div>${groups||emptyRows}</div></div>`;
  const taskList=items=>items.map(t=>`<a href="${safe(timelineLink(t))}"><span class="task-status ${safe(t.status)}">${safe(stateNames[t.status])}</span><span><b>${safe(t.title)}</b><small>${safe(t.lane+' · '+t.window)}${t.scheduleWarning?' · '+safe(t.scheduleWarning):''}</small></span><span aria-hidden="true">↗</span></a>`).join('');
  const pending=undated.length?`<details class="timeline-undated" open><summary>未完成 · 待定日期 / 日期待核对 · ${undated.length} 项</summary><div class="timeline-undated-list">${taskList(undated)}</div></details>`:'';
  const completed=archived.length?`<details class="timeline-undated"><summary>已完成 · 未记录计划日期 · ${archived.length} 项（无需为旧任务补排期）</summary><div class="timeline-undated-list">${taskList(archived)}</div></details>`:'';
  setMarkup('timeline-content',`<div class="timeline-legend"><span>横条：计划起止</span><span>虚线条：只记录一个日期</span><span>红色边框：逾期未完成</span>${visible.length&&outside?jump:''}</div>${chart}${pending}${completed}${!tasks.length?'<p class="empty-state">当前筛选下没有任务。</p>':''}`);
  document.querySelectorAll('#timeline-content [data-left]').forEach(el=>el.style.left=Number(el.dataset.left)+'%');
  document.querySelectorAll('#timeline-content [data-width]').forEach(el=>el.style.width=Number(el.dataset.width)+'%');
  document.querySelectorAll('#timeline-content [data-ticks]').forEach(el=>el.style.setProperty('--ticks',el.dataset.ticks));
}
function renderTimelineHistory(){
  const h=current.history||{},start=timelineState.anchor,days=timelineDays(),end=start+days-1,step=timelineState.scale==='week'?7:1;
  const all=TaskTimeline.entries(current).filter(e=>!timelineState.lane||e.laneId===timelineState.lane);
  const events=all.filter(e=>{const n=dateDay(projectDay(e.at));return n>=start&&n<=end});
  const sourceCount=events.filter(e=>e.kind==='review').length;
  $('timeline-note').textContent=`${dayISO(start)} — ${dayISO(end)} · ${events.length} 条时间记录，其中 ${sourceCount} 条为窗口复核。${h.error?'自动变化历史暂不可用。':h.startedAt?'自动变化从 '+fmt(h.startedAt)+' 起保存。':'自动变化等待本机连接后积累。'}`;
  const today=dateDay(projectDay(Date.now())),line=today>=start&&today<=end?`<span class="timeline-today-line" data-left="${(today-start+.5)/days*100}"><b>今天</b></span>`:'';
  const ticks=Array.from({length:days/step},(_,i)=>`<span>${dayISO(start+i*step).slice(5)}${step===7?' 起':''}</span>`).join('');
  const lanes=current.lanes.filter(l=>!timelineState.lane||l.id===timelineState.lane).map(l=>({id:l.id,title:l.title,windows:l.windows}));
  if(!timelineState.lane&&all.some(e=>!e.laneId))lanes.unshift({id:'',title:'项目整体',windows:[]});
  const rows=lanes.map(l=>{
    const items=events.filter(e=>(e.laneId||'')===l.id),buckets=new Map();
    items.forEach(e=>{const n=dateDay(projectDay(e.at)),bucket=Math.floor((n-start)/step);if(!buckets.has(bucket))buckets.set(bucket,[]);buckets.get(bucket).push(e)});
    const tasks=l.windows.flatMap(w=>w.tasks).filter(t=>t.status!=='cancelled'),done=tasks.filter(t=>t.status==='done').length;
    const desc=l.id?`${l.windows.length} 个窗口 · ${tasks.length?'当前 '+done+'/'+tasks.length+' 项完成':'尚无任务清单'}`:'起始快照与项目级记录';
    const points=[...buckets].map(([bucket,records])=>{
      const date=dayISO(start+bucket*step),selected=timelineState.selected?.lane===l.id&&timelineState.selected?.day===date;
      const types=new Set(records.map(e=>e.kind==='completion'?'actual':e.kind==='review'?'review':'observed'));
      const type=types.size>1?'mixed':[...types][0];
      return `<button type="button" class="timeline-node ${type}${selected?' selected':''}" data-left="${(bucket+.5)/(days/step)*100}" data-node-day="${date}" data-node-lane="${safe(l.id)}" aria-pressed="${selected}" aria-label="${safe(l.title+'，'+date+(step===7?' 起一周':'')+'，'+records.length+' 条记录，点击查看')}" title="${safe(date+' · '+records.length+' 条记录')}">${records.length}</button>`;
    }).join('');
    return `<div class="timeline-task-row history-track"><div class="timeline-task-label">${l.id?`<a href="${safe(pageHash(l.id))}"><strong>${safe(l.title)} ↗</strong></a>`:`<strong>${safe(l.title)}</strong>`}<small>${safe(desc)}</small></div><div class="timeline-plot">${line}${points||`<span class="timeline-no-record">${all.some(e=>(e.laneId||'')===l.id)?'当前范围无记录':'尚无带日期记录'}</span>`}</div></div>`;
  }).join('');
  const chart=`<div class="timeline-scroll" tabindex="0" aria-label="项目进展日期轴，可横向滚动，点击节点查看记录"><div class="timeline-chart" data-ticks="${days/step}"><div class="timeline-axis"><span>模块 · 当前状态</span><div class="timeline-ticks">${ticks}</div></div>${rows||'<p class="empty-state">尚未登记模块。</p>'}</div></div>`;
  const chosen=timelineState.selected;
  const filtered=chosen?events.filter(e=>(e.laneId||'')===chosen.lane&&dateDay(projectDay(e.at))>=dateDay(chosen.day)&&dateDay(projectDay(e.at))<dateDay(chosen.day)+step):events;
  const groups=new Map();filtered.forEach(e=>{const day=projectDay(e.at);if(!groups.has(day))groups.set(day,[]);groups.get(day).push(e)});
  const names={review:'窗口复核记录',completion:'实际完成 · 任务记录',baseline:'起始快照 · 看板记录',added:'观察到新增任务',removed:'观察到任务移出',schedule:'观察到日期调整'};
  const feed=[...groups].map(([day,items])=>`<section class="timeline-day"><div class="timeline-day-heading"><h3>${safe(day)}</h3><span>${items.length} 条记录 · 复核与观察时间不等于完成时间</span></div><ol class="timeline-events">${items.map(e=>{
    const action=e.kind==='status'?`观察到状态变化：${stateNames[e.previousStatus]||'未知'} → ${stateNames[e.status]||'未知'}`:names[e.kind];
    const link=e.taskId?taskLink(e.taskId):e.kind==='review'?pageHash(e.laneId,{window:e.windowId}):null;
    const source={update:'窗口进度文件',markdown:'Markdown 任务看板',project:'项目快照'}[e.source]||'保存的记录';
    const detail=e.kind==='review'?`来源：${source}。此时复核了窗口记录，不表示窗口内所有任务都在此时完成。`:e.kind==='baseline'?`当时全项目 ${e.done}/${e.total} 项完成、${e.total-e.done} 项待完成。这是已有状态，不计作当天新增完成。`:safe((e.lane||'')+' · '+(e.window||''))+(e.kind==='schedule'?' · 计划 '+safe(e.startsOn||'未定')+' → '+safe(e.dueOn||'未定'):'');
    return `<li><time>${safe(fmt(e.at))}</time><div><span class="timeline-event-type ${e.kind==='review'?'review':e.kind==='completion'?'actual':'observed'}">${safe(action||'看板记录')}</span>${link?`<a href="${safe(link)}">${safe(e.title)} ↗</a>`:`<strong>${safe(e.title||'开始保存项目历史')}</strong>`}<p>${detail}</p></div></li>`;
  }).join('')}</ol></section>`).join('');
  const nearest=all.length?`<button type="button" data-jump-day="${dateDay(projectDay(all[0].at))}">定位最近记录 →</button>`:'';
  const legend=`<div class="trajectory-legend"><span><i class="review"></i>记录复核</span><span><i class="actual"></i>实际完成</span><span><i class="observed"></i>看板观察</span><span><i class="mixed"></i>多种记录</span><span>点击数字节点查看记录</span>${!events.length?nearest:''}</div>`;
  const next=current.lanes.filter(l=>!timelineState.lane||l.id===timelineState.lane).map(l=>{
    const pending=l.windows.flatMap(w=>w.tasks.map(t=>({...t,windowId:w.id,laneId:l.id}))).filter(t=>!['done','cancelled'].includes(t.status));
    if(!pending.length)return '';
    return `<a href="${safe(pageHash(l.id,{status:'pending'}))}"><b>${safe(l.title)} <span>待完成 ${pending.length} 项 ↗</span></b><small>${safe(pending.slice(0,2).map(t=>t.title).join('；'))}${pending.length>2?'…':''}</small></a>`;
  }).join('');
  setMarkup('timeline-content',`${legend}${chart}<div class="timeline-feed-heading"><h3>${chosen?'选中节点的记录':'时间范围内的记录'}</h3>${chosen?'<button type="button" data-clear-node>显示全部节点</button>':''}</div><div class="timeline-feed">${feed||'<p class="timeline-empty">此范围暂无记录。可以调整日期，或等待窗口保存新的进度。</p>'}</div>${next?`<div class="timeline-next"><h3>接下来需要推进</h3><div>${next}</div></div>`:''}`);
  document.querySelectorAll('#timeline-content [data-left]').forEach(el=>el.style.left=Number(el.dataset.left)+'%');
  document.querySelectorAll('#timeline-content [data-ticks]').forEach(el=>el.style.setProperty('--ticks',el.dataset.ticks));
}
function setTimelineMode(mode){timelineState.mode=mode;timelineState.selected=null;try{localStorage.setItem('taskmap.timeline.mode.'+timelineState.project,mode)}catch{}renderTimeline();}
document.querySelectorAll('[data-timeline-mode]').forEach(b=>b.addEventListener('click',()=>setTimelineMode(b.dataset.timelineMode)));
for(const [id,key] of [['timeline-lane','lane'],['timeline-status','status'],['timeline-scale','scale']])$(id).addEventListener('change',()=>{timelineState[key]=$(id).value;timelineState.selected=null;renderTimeline()});
$('timeline-prev').addEventListener('click',()=>{timelineState.anchor-=timelineDays();timelineState.selected=null;renderTimeline()});
$('timeline-next').addEventListener('click',()=>{timelineState.anchor+=timelineDays();timelineState.selected=null;renderTimeline()});
$('timeline-today').addEventListener('click',()=>{timelineState.anchor=dateDay(projectDay(Date.now()))-(timelineDays()-4);timelineState.selected=null;renderTimeline()});
$('timeline-content').addEventListener('click',e=>{
  const b=e.target.closest('[data-jump-day]'),node=e.target.closest('[data-node-day]');
  if(b){timelineState.anchor=Number(b.dataset.jumpDay)-1;timelineState.selected=null;renderTimeline()}
  else if(node){timelineState.selected={day:node.dataset.nodeDay,lane:node.dataset.nodeLane};renderTimeline();document.querySelector('.timeline-feed-heading')?.scrollIntoView({block:'nearest'});}
  else if(e.target.closest('[data-clear-node]')){timelineState.selected=null;renderTimeline()}
  else if(e.target.closest('[data-open-history]'))setTimelineMode('history');
});
if(current)renderTimeline();
