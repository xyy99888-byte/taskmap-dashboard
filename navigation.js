globalThis.DashboardNavigation=(()=>{
  const media=matchMedia('(max-width: 900px)');
  let activeKey=null,activeURL=null,restoring=false,saveTimer;
  const key=()=>crypto.randomUUID();
  function ensureState(){
    if(!history.state?.taskmap){history.replaceState({...history.state,taskmap:{key:key(),depth:0}},'',location.href);}
    return history.state.taskmap;
  }
  function saveView(){
    if(restoring||!current)return;
    const state=ensureState();
    const scrollers={};
    for(const selector of ['.timeline-scroll','.timeline-feed','.table-wrap']){
      const el=document.querySelector(selector);if(el)scrollers[selector]=[el.scrollLeft,el.scrollTop];
    }
    const snapshot={y:scrollY,scrollers,expanded:[...expanded],filter,sourceOpen:document.querySelector('.source-disclosure').open};
    if(typeof timelineState!=='undefined')snapshot.timeline={...timelineState};
    history.replaceState({...history.state,taskmap:{...state,view:snapshot}},'',location.href);
  }
  function closeMenu(focus=false){
    document.body.classList.remove('nav-open');$('nav-backdrop').hidden=true;$('nav-toggle').setAttribute('aria-expanded','false');
    $('app-sidebar').inert=media.matches;$('main-content').inert=false;
    $('app-sidebar').removeAttribute('aria-modal');$('app-sidebar').removeAttribute('role');
    if(focus)$('nav-toggle').focus();
  }
  function openMenu(){
    if(!media.matches)return;
    document.body.classList.add('nav-open');$('nav-backdrop').hidden=false;$('nav-toggle').setAttribute('aria-expanded','true');
    $('app-sidebar').inert=false;$('main-content').inert=true;
    $('app-sidebar').setAttribute('role','dialog');$('app-sidebar').setAttribute('aria-modal','true');$('nav-close').focus();
  }
  function renderShell(){
    if(!current)return;
    const view=route();
    for(const page of ['overview','timeline','windows'])$(page+'-view').hidden=view.page!==page;
    $('detail-view').hidden=view.overview;
    const labels={overview:'项目总览',timeline:'项目时间轴',windows:'工作窗口',tasks:'全部任务',module:'模块详情',missing:'页面未找到'};
    const lane=current.lanes.find(l=>l.id===view.laneId),window=windowsOf(current).find(w=>w.id===view.params.get('window'));
    const title=lane?.title||labels[view.page];
    const parts=[`<a href="#/overview" id="project-name">${safe(current.project)}</a>`];
    if(view.page!=='overview')parts.push(`<span aria-hidden="true">/</span>${window&&lane?`<a href="${safe(pageHash(lane.id))}">${safe(lane.title)}</a><span aria-hidden="true">/</span><span>${safe(window.title)}</span>`:`<span>${safe(title)}</span>`}`);
    setMarkup('nav-breadcrumbs',parts.join(''));
    if(view.overview)document.title=title+' · '+current.project;
    document.querySelectorAll('.primary-nav [data-page]').forEach(a=>{if(a.dataset.page===view.page)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
    setMarkup('module-nav',current.lanes.map(l=>`<a href="${safe(pageHash(l.id))}" ${l.id===view.laneId?'aria-current="page"':''}><i data-color="${safe(l.color)}"></i><span>${safe(l.title)}</span><small>${l.windows.length}</small></a>`).join('')||'<span class="nav-empty">尚未登记模块</span>');
    $('nav-task-count').textContent=windowsOf(current).flatMap(w=>w.tasks).filter(t=>!['done','cancelled'].includes(t.status)).length;
    $('nav-task-count').title='未完成任务数';
    $('parent-link').href=TaskmapRoutes.parent(location.hash);
    $('nav-back').disabled=ensureState().depth===0&&view.page==='overview';
    $('nav-back').title=ensureState().depth>0?'返回刚才的页面，保留筛选和位置':'返回上一级';
    $('load-state').hidden=true;$('load-actions').hidden=true;
    applyColors();
  }
  function routeChanged(){
    if(!current)return;
    let state=ensureState();
    // Native hash links inherit history.state. Give each new location its own key.
    if(activeKey===state.key&&activeURL!==location.href){
      state={key:key(),depth:state.depth+1};history.replaceState({...history.state,taskmap:state},'',location.href);
    }
    if(activeKey===state.key&&activeURL===location.href)return;
    restoring=true;activeKey=state.key;activeURL=location.href;
    const saved=state.view;
    if(saved){
      expanded.clear();(saved.expanded||[]).forEach(id=>expanded.add(id));filter=saved.filter||'all';
      if(saved.timeline&&typeof timelineState!=='undefined')Object.assign(timelineState,saved.timeline);
      document.querySelector('.source-disclosure').open=!!saved.sourceOpen;
    }
    render(current);closeMenu();
    requestAnimationFrame(()=>{
      if(saved){
        for(const [selector,position] of Object.entries(saved.scrollers||{})){const el=document.querySelector(selector);if(el){el.scrollLeft=position[0];el.scrollTop=position[1];}}
        window.scrollTo(0,saved.y||0);
      }else{
        const taskId=route().params.get('task');
        const target=taskId&&[...document.querySelectorAll('[data-task-id]')].find(el=>el.dataset.taskId===taskId);
        if(target){target.scrollIntoView({block:'center'});target.focus({preventScroll:true});}
        else {window.scrollTo(0,0);document.querySelector('#'+(route().overview?route().page:'detail')+'-view h1')?.focus({preventScroll:true});}
      }
      restoring=false;saveView();
    });
  }
  function navigate(hash){
    if(!hash.startsWith('#/'))return;
    if(hash===location.hash){closeMenu();return;}
    saveView();const state=ensureState();
    history.pushState({taskmap:{key:key(),depth:state.depth+1}},'',hash);routeChanged();
  }
  function replaceHash(hash){history.replaceState(history.state,'',hash);activeURL=location.href;saveView();}
  function scheduleSave(){clearTimeout(saveTimer);saveTimer=setTimeout(saveView,120);}
  ensureState();if('scrollRestoration' in history)history.scrollRestoration='manual';
  document.addEventListener('click',e=>{
    const a=e.target.closest('a[href^="#/"]');
    if(a&&!e.defaultPrevented&&e.button===0&&!e.ctrlKey&&!e.metaKey&&!e.shiftKey&&!e.altKey&&!a.target){e.preventDefault();navigate(a.getAttribute('href'));}
    else scheduleSave();
  });
  document.addEventListener('change',scheduleSave);document.addEventListener('scroll',scheduleSave,true);
  window.addEventListener('pagehide',saveView);window.addEventListener('popstate',routeChanged);
  $('nav-back').addEventListener('click',()=>{saveView();if(ensureState().depth>0)history.back();else navigate(TaskmapRoutes.parent(location.hash));});
  $('nav-toggle').addEventListener('click',openMenu);$('nav-close').addEventListener('click',()=>closeMenu(true));$('nav-backdrop').addEventListener('click',()=>closeMenu(true));
  document.addEventListener('keydown',e=>{
    if(!document.body.classList.contains('nav-open'))return;
    if(e.key==='Escape'){e.preventDefault();closeMenu(true);}
    if(e.key==='Tab'){
      const items=[...$('app-sidebar').querySelectorAll('a[href],button,select')].filter(el=>!el.disabled&&!el.hidden&&el.getClientRects().length);
      if(e.shiftKey&&document.activeElement===items[0]){e.preventDefault();items.at(-1).focus();}
      else if(!e.shiftKey&&document.activeElement===items.at(-1)){e.preventDefault();items[0].focus();}
    }
  });
  media.addEventListener('change',()=>closeMenu());closeMenu();
  $('refresh-now').addEventListener('click',()=>refresh(true));$('retry-load').addEventListener('click',()=>refresh(true));
  queueMicrotask(()=>{if(current)routeChanged();});
  return {render:renderShell,routeChanged,navigate,replaceHash,saveView};
})();
