let current = null;
let filter = 'all';
let timer;
let projectCatalog=[];
const expanded = new Set();
const $ = id => document.getElementById(id);
const safe = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const stateNames = {todo:'待办',in_progress:'进行中',review:'待验收',blocked:'有阻塞',done:'已完成',cancelled:'已取消'};
const stages = {local:'本地完成',merged:'已合并',deployed:'已上线',delivered:'已交付',unverified:'尚未验证'};
const windowsOf = data => data.lanes.flatMap(lane => lane.windows.map(w => ({...w,lane:lane.title,laneId:lane.id,color:lane.color})));
const pending = w => w.tasks.filter(t => !['done','cancelled'].includes(t.status));
const blocked = t => t.status === 'blocked' || (t.unmetDependencies?.length > 0 && !['done','cancelled'].includes(t.status));
function pageHash(laneId, options={}) {
  const params=new URLSearchParams();
  Object.entries(options).forEach(([key,value])=>{if(value!==undefined&&value!==null&&value!=='')params.set(key,value)});
  return (laneId ? '#/module/'+encodeURIComponent(laneId) : '#/tasks')+(params.size?'?'+params.toString():'');
}
function route() {
  const [path, query='']=(location.hash.slice(1)||'/overview').split('?');
  const params=new URLSearchParams(query);
  if(path==='/overview')return {overview:true,params};
  if(path==='/tasks')return {overview:false,laneId:null,params};
  try {if(path.startsWith('/module/'))return {overview:false,laneId:decodeURIComponent(path.slice(8)),params};} catch {}
  return {overview:false,invalid:true,params};
}
function taskLink(taskId) {
  const owner=windowsOf(current).find(w=>w.tasks.some(t=>t.id===taskId));
  return owner ? pageHash(owner.laneId,{window:owner.id,task:taskId}) : null;
}
function applyColors() {
  document.querySelectorAll('[data-color]').forEach(el=>{if(/^#[0-9a-f]{6}$/i.test(el.dataset.color))el.style.setProperty('--lane',el.dataset.color)});
  document.querySelectorAll('[data-share]').forEach(el=>{el.style.width=Math.max(0,Math.min(100,Number(el.dataset.share)||0))+'%'});
}
function fmt(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return '未记录';
  try { return new Intl.DateTimeFormat('zh-CN',{timeZone:current?.timezone || 'Asia/Shanghai',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(value)); }
  catch { return new Date(value).toISOString().slice(0,16).replace('T',' '); }
}
function checkTime(value) {
  try { return new Intl.DateTimeFormat('zh-CN',{timeZone:current?.timezone||'Asia/Shanghai',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(value)); }
  catch { return fmt(value); }
}
function meter(value, color, label) {
  return `<progress max="100" value="${Number(value) || 0}" data-color="${safe(color)}" aria-label="${safe(label)}"></progress>`;
}
function progressRing(done, total) {
  const share = total > 0 ? Math.max(0, Math.min(100, done / total * 100)) : 0;
  const complete = total > 0 && done === total;
  return `<svg class="progress-ring" viewBox="0 0 64 64" aria-hidden="true" focusable="false"><circle class="ring-track" cx="32" cy="32" r="24"/>${share > 0 ? `<circle class="ring-value" cx="32" cy="32" r="24" pathLength="100" stroke-dasharray="${share} 100" transform="rotate(-90 32 32)"/>` : ''}${complete ? '<path class="ring-check" d="m22 32 7 7 14-15"/>' : ''}</svg>`;
}
function taskDetails(task, full=false) {
  const rows = [
    task.stage && ['交付阶段', stages[task.stage] || task.stage],
    task.acceptance && ['验收标准',task.acceptance],
    task.blocker && ['阻塞原因',task.blocker],
    task.nextAction && ['解除 / 下一步',task.nextAction],
    task.unmetDependencies?.length && ['尚需等待',task.unmetDependencies.map(d=>d.title + (d.missing?'（未登记）':'')).join('、')],
    task.evidence && ['完成依据',task.evidence],
    task.startsOn && ['计划开始',task.startsOn],
    task.dueOn && ['计划截止',task.dueOn],
    task.completedAt && ['记录的实际完成时间',fmt(task.completedAt)],
    task.scheduleWarning && ['日期待核对',task.scheduleWarning]
  ].filter(Boolean);
  const dependencies=full ? (task.dependsOn||[]).map(id=>{
    const link=taskLink(id), dependency=windowsOf(current).flatMap(w=>w.tasks).find(t=>t.id===id);
    return link?`<a href="${safe(link)}">${dependency.done?'✓':'○'} ${safe(dependency.title)} →</a>`:`<span>${safe(id)}（尚未登记）</span>`;
  }).join('') : '';
  return `<article class="task-card ${full?'full-task':''}" ${full?`data-task-id="${safe(task.id)}" tabindex="-1"`:''}><div class="task-heading"><span class="task-status ${safe(task.status)}">${stateNames[task.status]}</span><span class="priority">${safe(task.priority)}</span></div>${full&&task.group?`<span class="task-group">${safe(task.group)}</span>`:''}<h3>${safe(task.title)}</h3>${rows.map(([name,value])=>`<p><b>${name}</b>${safe(value)}</p>`).join('')}${full&&!task.evidence?'<p class="unrecorded">单项完成依据尚未记录，可查看本窗口的记录依据。</p>':''}${dependencies?`<div class="dependency-links"><b>关联任务</b>${dependencies}</div>`:''}${full&&task.milestone?`<a class="milestone-link" href="${safe(pageHash(null,{milestone:task.milestone}))}">阶段：${safe(task.milestone)} →</a>`:''}</article>`;
}
function render(data) {
  current = data;
  const windows = windowsOf(data);
  const tasks = windows.flatMap(w=>w.tasks).filter(t=>t.status!=='cancelled');
  const done = tasks.filter(t=>t.done).length;
  const unknown = windows.filter(w=>!w.taskCount).length;
  const active = windows.filter(w=>w.activity==='进行中').length;
  const blockedTasks = tasks.filter(blocked).length;
  const reviews = windows.filter(w=>w.needsReview).length;
  document.title = `${data.project} · 项目进度`;
  $('project-name').textContent = data.project;
  const selectedProject=new URLSearchParams(location.search).get('project')||data.projectId;
  if(projectCatalog.some(p=>p.id===selectedProject))$('project-select').value=selectedProject;
  $('scope').textContent = data.scope || '查看各支线的任务、依赖与交付进展。';
  $('clock').textContent = '最近检查 ' + checkTime(data.serverCheckAt||data.generatedAt);
  $('refresh-rate').textContent = `每 ${data.refreshSeconds} 秒检查已保存记录`;
  $('live').textContent = '自动检查中';
  $('live').classList.remove('error');
  const cloud=data.transport?.mode==='cloud';
  $('cloud-home').hidden=!cloud;
  $('view-location').textContent=cloud?'仅登录后查看自己的项目':'仅在这台电脑上查看';
  if(cloud){
    $('live').textContent=data.transport.online?'本机同步中':data.transport.receivedAt?'本机离线':'等待本机连接';
    $('live').classList.toggle('error',!data.transport.online);
    $('refresh-rate').textContent=data.transport.receivedAt?'收到本机数据：'+fmt(data.transport.receivedAt):'尚未收到本机数据';
  }
  $('warnings').hidden = !data.warnings?.length;
  $('warnings').textContent = (data.warnings || []).join(' ');
  const sources={update:0,markdown:0,project:0};
  windows.forEach(w=>sources[w.sourceKind]=(sources[w.sourceKind]||0)+1);
  const reviewed=windows.map(w=>w.reviewedAt).filter(value=>Number.isFinite(Date.parse(value))).sort((a,b)=>Date.parse(b)-Date.parse(a))[0];
  $('sync-coverage').innerHTML=`<div><strong>${sources.project?'部分任务进度仍是快照':'任务进度来自已保存的记录'}</strong><span>${sources.update} 个窗口进度文件 · ${sources.markdown} 个任务看板 · ${sources.project} 个进度快照</span></div><p>文件写入新进度后，通常在下一轮检查显示；聊天中有新动作不会自动改变完成度。<span>最近一次任务复核：${fmt(reviewed)}（仅代表最近更新的记录）。</span></p>`;
  $('stats').innerHTML = [
    ['已记录任务完成度',tasks.length ? Math.round(done/tasks.length*100)+'%' : '—',`${done} / ${tasks.length} 项 · ${unknown} 个窗口尚无清单`,pageHash(null,{status:'done'})],
    ['项目支线',data.lanes.length,`${windows.length} 个已登记窗口`,pageHash(null)],
    ['当前阻塞',blockedTasks,'含尚未满足的任务依赖',pageHash(null,{status:'blocked'})],
    ['正在工作的窗口',active,`${reviews} 个窗口的进度需要复核`,pageHash(null,{activity:'active'})]
  ].map(([name,value,note,link],i)=>`<a class="stat${i===0?' stat-progress':''}" href="${safe(link)}"><div class="label">${safe(name)} <span aria-hidden="true">↗</span></div><div class="num">${i===0?progressRing(done,tasks.length):''}${safe(value)}</div><div class="sub">${safe(note)}</div></a>`).join('');
  $('lanes').innerHTML = data.lanes.map(lane=>{
    const items=lane.windows.flatMap(w=>w.tasks).filter(t=>t.status!=='cancelled');
    const d=items.filter(t=>t.done).length, p=items.length?Math.round(d/items.length*100):0;
    const incomplete=items.filter(t=>!t.done);
    const counts={done:0,in_progress:0,review:0,blocked:0,todo:0};
    items.forEach(t=>counts[t.done?'done':blocked(t)?'blocked':t.status]++);
    const names={...stateNames,todo:'其他待办',blocked:'阻塞 / 待依赖'};
    const unknown=lane.windows.filter(w=>!w.taskCount).length;
    const segments=Object.entries(counts).filter(([,n])=>n>0).map(([key,n])=>`<a class="chart-segment ${key}" data-share="${n/items.length*100}" href="${safe(pageHash(lane.id,{status:key}))}" aria-label="${safe(lane.title)}：${names[key]} ${n} 项，查看任务" title="${names[key]} ${n} 项 · ${Math.round(n/items.length*100)}%"><span>${n/items.length>=.13?n+' 项':''}</span></a>`).join('');
    const remaining=incomplete.slice(0,2).map(t=>t.title).join('；');
    const activeWindows=lane.windows.filter(w=>w.activity==='进行中'||w.tasks.some(t=>t.status==='in_progress'));
    const activeTodos=activeWindows.map(w=>`<section class="busy-window"><div class="busy-heading"><a href="${safe(pageHash(lane.id,{window:w.id}))}"><span class="busy-dot"></span>${safe(w.title)} →</a><small>${w.activity==='进行中'?'窗口正在工作':'有进行中的任务'} · 待办 ${pending(w).length} 项</small></div>${w.needsReview?'<p class="busy-stale">窗口有新动态，以下是最近记录的待办，等待窗口更新。</p>':''}<ul>${pending(w).map(t=>`<li><a href="${safe(pageHash(lane.id,{window:w.id,task:t.id}))}"><span class="busy-task-state">${stateNames[t.status]}</span><span>${safe(t.title)}</span><span aria-hidden="true">↗</span></a></li>`).join('')||'<li class="busy-empty">当前没有登记待办；窗口仍在工作，不能据此认定已全部完成。</li>'}</ul></section>`).join('');
    return `<div class="chart-row"><a class="chart-module lane-entry" href="${safe(pageHash(lane.id))}"><b>${safe(lane.title)} <span aria-hidden="true">→</span></b><small>${lane.windows.length} 个窗口${unknown?' · '+unknown+' 个待梳理':''}</small></a><div class="chart-plot"><div class="plot-caption"><strong>${items.length?'已完成 '+p+'%':'待梳理'}</strong><small>${items.length?d+' / '+items.length+' 项完成':'尚未登记具体任务'}${lane.windows.some(w=>w.needsReview)?' · 待复核':''}</small></div><div class="chart-track ${items.length?'':'untracked'}">${segments||'<span class="untracked-label">暂无可计算的任务清单</span>'}</div></div><a class="chart-remaining" href="${safe(pageHash(lane.id,{status:items.length?'pending':''}))}"><strong>${items.length?'还剩 '+incomplete.length+' 项':'进入模块梳理'} <span aria-hidden="true">→</span></strong><span title="${safe(remaining)}">${safe(remaining|| (items.length?'已记录事项均已完成':'查看已有窗口与记录'))}</span></a>${activeTodos?`<div class="busy-windows">${activeTodos}</div>`:''}</div>`;
  }).join('');
  const next=windows.flatMap(w=>pending(w).map(t=>({...t,window:w.title,href:pageHash(w.laneId,{window:w.id,task:t.id})})))
    .sort((a,b)=>a.priority.localeCompare(b.priority) || Number(blocked(b))-Number(blocked(a))).slice(0,6);
  $('next').innerHTML = next.map(t=>`<li><a class="next-entry" href="${safe(t.href)}"><i class="dot"></i><span><strong>${safe(t.window)} · ${safe(t.priority)} · ${stateNames[t.status]}</strong>${safe(t.title)}${t.blocker?`<small class="blocker-note">${safe(t.blocker)}</small>`:''}</span><span class="entry-arrow" aria-hidden="true">→</span></a></li>`).join('') || '<li>目前没有已记录的待办。</li>';
  const milestones = new Map();
  tasks.filter(t=>t.milestone).forEach(t=>{if(!milestones.has(t.milestone))milestones.set(t.milestone,[]);milestones.get(t.milestone).push(t)});
  $('milestone-panel').hidden = !milestones.size;
  $('milestones').innerHTML = [...milestones].map(([name,items],i)=>{
    const d=items.filter(t=>t.done).length;
    return `<a class="milestone" href="${safe(pageHash(null,{milestone:name}))}"><span class="milestone-number">${String(i+1).padStart(2,'0')}</span><div><b>${safe(name)} →</b><p>${d}/${items.length} 项完成${items.some(blocked)?' · 等待依赖':''}</p>${meter(Math.round(d/items.length*100),'#5b72e8',name)}</div></a>`;
  }).join('');
  const visible=windows.filter(w=>filter==='all'||filter==='active'&&(w.activity==='进行中'||w.tasks.some(t=>t.status==='in_progress'))||filter==='blocked'&&w.tasks.some(blocked)||filter==='review'&&(w.needsReview||w.tasks.some(t=>t.status==='review'))||filter==='todo'&&pending(w).length);
  $('rows').innerHTML = visible.map(w=>{
    const next=pending(w).sort((a,b)=>a.priority.localeCompare(b.priority)).slice(0,2);
    const isOpen=expanded.has(w.id);
    const progress=w.percent===null?'<span class="unknown">待梳理</span>':`<div class="mini">${meter(w.percent,w.color,w.title+'清单完成度')}<strong>${w.percent}%</strong></div><div class="lane-sub">${w.doneCount} / ${w.taskCount} 项</div>`;
    return `<tr><td><a class="lane-tag" data-color="${safe(w.color)}" href="${safe(pageHash(w.laneId))}">${safe(w.lane)}</a><a class="window-title window-link" href="${safe(pageHash(w.laneId,{window:w.id}))}">${safe(w.title)} →</a><span class="window-summary">${safe(w.summary)}</span><button class="detail-button" data-window="${safe(w.id)}" aria-expanded="${isOpen}" aria-controls="detail-${safe(w.id)}">${isOpen?'收起详情':'快速查看清单'} ${isOpen?'−':'+'}</button></td><td>${progress}</td><td><div class="todo">${next.length?next.map(t=>`<div>${safe(t.title)}${blocked(t)?'<span class="review">等待依赖或外部条件</span>':''}</div>`).join(''):`<span class="unknown">${w.taskCount?'清单中暂无待办':'尚未登记任务'}</span>`}</div></td><td><span class="status ${w.activity==='进行中'?'active':''}">${safe(w.activity)}</span>${w.needsReview?'<span class="review">● 进度待复核</span>':''}</td><td>${fmt(w.reviewedAt)}<span class="window-summary updated-at">动态 ${fmt(w.updatedAt)}</span></td></tr><tr class="detail-row" id="detail-${safe(w.id)}" ${isOpen?'':'hidden'}><td colspan="5"><div class="evidence-line"><b>记录依据：</b>${safe(w.evidence||'尚未记录')} ${w.owner?` · 负责：${safe(w.owner)}`:''}</div><div class="task-grid">${w.tasks.map(t=>taskDetails(t)).join('')||'<p class="unknown">此窗口暂无任务清单，未计入完成百分比。</p>'}</div></td></tr>`;
  }).join('') || '<tr><td colspan="5">此筛选下暂无窗口。</td></tr>';
  renderDetail();
  if(typeof renderTimeline==='function')renderTimeline();
  applyColors();
  $('source').textContent = `任务记录${data.sourceHealth.markdownBoards?' · Markdown 看板':''} · 窗口动态${data.sourceHealth.codex==='ok'?'已接入':data.sourceHealth.codex==='disabled'?'未接入':'暂不可用'}`;
}
const markupCache=new Map();
function setMarkup(id,html) {
  if(markupCache.get(id)!==html){$(id).innerHTML=html;markupCache.set(id,html)}
}
function renderDetail() {
  if(!current)return;
  const view=route();
  $('overview-view').hidden=!view.overview;
  $('detail-view').hidden=view.overview;
  if(view.overview)return;
  const lane=view.laneId ? current.lanes.find(l=>l.id===view.laneId) : null;
  const params=view.params;
  const selectedId=params.get('window');
  const milestone=params.get('milestone');
  const activity=params.get('activity');
  const status=['all','pending','todo','done','in_progress','review','blocked','cancelled'].includes(params.get('status'))?params.get('status'):'all';
  const search=params.get('q')||'';
  let windows=windowsOf(current).filter(w=>!lane||w.laneId===lane.id);
  if(activity==='active')windows=windows.filter(w=>w.activity==='进行中');
  if(milestone)windows=windows.filter(w=>w.tasks.some(t=>t.milestone===milestone));
  const selected=selectedId ? windows.find(w=>w.id===selectedId) : null;
  const invalid=view.invalid||(view.laneId&&!lane)||(selectedId&&!selected);
  const scope=selected? [selected]:windows;
  const scopeTasks=scope.flatMap(w=>w.tasks).filter(t=>!milestone||t.milestone===milestone);
  const tracked=scopeTasks.filter(t=>t.status!=='cancelled');
  const done=tracked.filter(t=>t.done).length;
  const heading=invalid?'没有找到这个模块或窗口':selected?.title||lane?.title||(milestone?`阶段：${milestone}`:activity==='active'?'正在工作的窗口':'全部模块与任务');
  const options=Object.fromEntries(params);
  delete options.task;
  const filterLink=nextStatus=>pageHash(view.laneId,{...options,status:nextStatus==='all'?'':nextStatus});
  $('detail-title').textContent=heading;
  document.title=`${heading} · ${current.project}`;
  $('detail-description').textContent=invalid?'这个地址可能已经过期，请从左侧选择模块或返回总览。':selected?.summary||lane?.description||`${windows.length} 个窗口共同推进 · 已记录 ${tracked.length} 项任务，已完成 ${done} 项。`;
  setMarkup('breadcrumbs',`<a href="#/overview">${safe(current.project)}</a><span aria-hidden="true">/</span>${selected?`<a href="${safe(pageHash(lane?.id||selected.laneId))}">${safe(selected.lane)}</a><span aria-hidden="true">/</span>`:''}<span>${safe(selected?'窗口详情':lane?.title||'全部任务')}</span>`);
  setMarkup('module-nav',`<a href="${pageHash(null)}" ${!view.laneId?'aria-current="page"':''}><span>全部模块</span><small>${windowsOf(current).length}</small></a>`+current.lanes.map(l=>`<a href="${safe(pageHash(l.id))}" ${l.id===view.laneId?'aria-current="page"':''}><span>${safe(l.title)}</span><small>${l.windows.length}</small></a>`).join(''));
  const stats=[['已记录任务',tracked.length,'all'],['已完成',done,'done'],['待完成',tracked.length-done,'pending'],['有阻塞',tracked.filter(blocked).length,'blocked']];
  setMarkup('detail-stats',stats.map(([name,value,key])=>`<a class="detail-stat ${status===key?'selected':''}" href="${safe(filterLink(key))}"><span>${name}</span><strong>${value}</strong></a>`).join(''));
  $('all-windows-link').href=pageHash(view.laneId,{milestone,activity});
  setMarkup('window-cards',invalid?'<p class="empty-state">请重新选择一个已登记的模块。</p>':windows.map(w=>{
    const windowTasks=w.tasks.filter(t=>t.status!=='cancelled'&&(!milestone||t.milestone===milestone));
    return `<a class="window-card ${selectedId===w.id?'selected':''}" href="${safe(pageHash(w.laneId,{window:w.id,milestone}))}" ${selectedId===w.id?'aria-current="page"':''}><div><span class="status ${w.activity==='进行中'?'active':''}">${safe(w.activity)}</span><span class="card-arrow" aria-hidden="true">→</span></div><h3>${safe(w.title)}</h3><p>${safe(w.summary||'此窗口尚未填写摘要。')}</p><small>${windowTasks.filter(t=>t.done).length} / ${windowTasks.length} 项完成${w.needsReview?' · 进度待复核':''}</small></a>`;
  }).join('')||'<p class="empty-state">此范围暂时没有窗口。</p>');
  if($('detail-search').value!==search)$('detail-search').value=search;
  const matchStatus=t=>status==='all'||status==='pending'&&!['done','cancelled'].includes(t.status)||status==='blocked'&&blocked(t)||status===t.status&&(!['todo','review','in_progress'].includes(status)||!blocked(t));
  const matches=t=>matchStatus(t)&&(!milestone||t.milestone===milestone)&&[t.title,t.evidence,t.blocker,t.nextAction,t.acceptance,t.group,t.milestone].filter(Boolean).join(' ').toLocaleLowerCase().includes(search.toLocaleLowerCase());
  const filters=[['all','全部',scopeTasks.length],['pending','待完成',tracked.length-done],['in_progress','进行中',scopeTasks.filter(t=>t.status==='in_progress'&&!blocked(t)).length],['review','待验收',scopeTasks.filter(t=>t.status==='review'&&!blocked(t)).length],['blocked','有阻塞',scopeTasks.filter(blocked).length],['todo','其他待办',scopeTasks.filter(t=>t.status==='todo'&&!blocked(t)).length],['done','已完成',done]];
  if(scopeTasks.some(t=>t.status==='cancelled'))filters.push(['cancelled','已取消',scopeTasks.filter(t=>t.status==='cancelled').length]);
  setMarkup('task-filters',filters.map(([key,name,count])=>`<a href="${safe(filterLink(key))}" ${status===key?'aria-current="page"':''} class="${status===key?'selected':''}">${name} <span>${count}</span></a>`).join(''));
  const matched=scopeTasks.filter(matches);
  $('task-results').textContent=invalid?'暂无可展示数据':`显示 ${matched.length} / ${scopeTasks.length} 项${milestone?' · '+milestone:''}${search?' · 搜索“'+search+'”':''}`;
  const groupHtml=scope.map(w=>{
    const tasks=w.tasks.filter(matches);
    if(!tasks.length&&w.tasks.length&&(!selected||search||status!=='all'))return '';
    const source={update:'窗口写回的进度文件',markdown:'Markdown 任务看板',project:'进度快照（尚未接入窗口写回）'}[w.sourceKind]||'任务记录';
    return `<section class="window-task-group"><div class="group-title"><div><span class="lane-tag" data-color="${safe(w.color)}">${safe(w.lane)}</span><h3>${safe(w.title)}</h3></div><span class="group-count">${tasks.length} 项</span></div><div class="window-evidence"><p>${safe(w.summary||'尚未填写窗口摘要')}</p><p><b>记录依据</b>${safe(w.evidence||'尚未记录，需窗口补充。')}</p><div class="evidence-meta"><span>${source} · 复核于 ${fmt(w.reviewedAt)}</span>${w.owner?`<span>负责：${safe(w.owner)}</span>`:''}${w.needsReview?'<span class="review">有新动态，以上进度仍待复核</span>':''}</div></div><div class="task-grid detail-task-grid">${tasks.map(t=>taskDetails(t,true)).join('')||'<p class="empty-state">这个窗口还没有登记具体任务。当前不会将它算作已经完成。</p>'}</div></section>`;
  }).join('');
  setMarkup('module-content',invalid?'<p class="empty-state">返回总览后重新进入即可。</p>':groupHtml||`<div class="empty-state"><strong>没有符合当前条件的任务</strong><p>可以切换任务状态或清空搜索，查看这个范围的其他记录。</p><a class="text-link" href="${safe(pageHash(view.laneId,{window:selectedId,milestone,activity}))}">清除筛选 →</a></div>`);
  document.querySelectorAll('#module-content [data-task-id]').forEach(el=>el.classList.toggle('highlight-task',el.dataset.taskId===params.get('task')));
  applyColors();
}
function onRouteChange() {
  if(!current)return;
  renderDetail();
  if(route().overview){document.title=`${current.project} · 项目进度`;window.scrollTo(0,0);return;}
  requestAnimationFrame(()=>{
    const taskId=route().params.get('task');
    const target=taskId&&[...document.querySelectorAll('#module-content [data-task-id]')].find(el=>el.dataset.taskId===taskId);
    if(target){target.scrollIntoView({block:'center'});target.focus({preventScroll:true});}
    else {window.scrollTo(0,0);$('detail-title').focus({preventScroll:true});}
  });
}
window.addEventListener('hashchange',onRouteChange);
$('detail-search').addEventListener('input',event=>{
  if(event.isComposing)return;
  const view=route();
  const options=Object.fromEntries(view.params);
  delete options.task;
  options.q=event.target.value;
  history.replaceState(null,'',pageHash(view.laneId,options));
  renderDetail();
});
async function loadProjects(){
  try{
    const response=await fetch('/api/projects',{cache:'no-store'});
    if(!response.ok)throw Error('项目列表暂不可读');
    const value=await response.json();projectCatalog=value.projects;
    $('project-select').innerHTML=projectCatalog.map(p=>`<option value="${safe(p.id)}">${safe(p.name)}</option>`).join('');
    const selected=new URLSearchParams(location.search).get('project')||current?.projectId;
    if(projectCatalog.some(p=>p.id===selected))$('project-select').value=selected;
  }catch{$('project-select').innerHTML='<option value="">项目列表暂不可用</option>'}
}
$('project-select').addEventListener('change',()=>{
  const url=new URL(location.href);url.searchParams.set('project',$('project-select').value);url.hash='/overview';location.assign(url.href);
});
async function refresh() {
  clearTimeout(timer);
  try {
    const project=new URLSearchParams(location.search).get('project');
    const response=await fetch('/api/state'+(project?'?project='+encodeURIComponent(project):''),{cache:'no-store'});
    if(project&&!response.headers.get('content-type')?.includes('application/json'))throw Error('登录可能已过期，请通过“我的项目”重新登录。');
    const data=await response.json();
    if(!response.ok)throw Error(data.error||'读取失败');
    const firstLoad=!current;
    render(data);
    if(firstLoad)onRouteChange();
  } catch(error) {
    $('live').textContent='同步中断';$('live').classList.add('error');
    $('warnings').hidden=false;
    $('warnings').textContent=`${current?'当前显示上次成功读取的记录。 ':''}${error.message}`;
  } finally {timer=setTimeout(refresh,(current?.refreshSeconds||5)*1000)}
}
document.querySelectorAll('[data-filter]').forEach(button=>button.addEventListener('click',()=>{
  filter=button.dataset.filter;
  document.querySelectorAll('[data-filter]').forEach(b=>b.classList.toggle('selected',b===button));
  if(current)render(current);
}));
$('rows').addEventListener('click',event=>{
  const button=event.target.closest('[data-window]');if(!button)return;
  const id=button.dataset.window;
  expanded.has(id)?expanded.delete(id):expanded.add(id);
  const row=document.getElementById('detail-'+id);
  row.hidden=!expanded.has(id);
  button.setAttribute('aria-expanded',String(expanded.has(id)));
  button.textContent=expanded.has(id)?'收起详情 −':'查看清单与依据 +';
});
loadProjects();refresh();
