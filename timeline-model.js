/* Read-only timeline projections. Review and observation dates never become task dates. */
globalThis.TaskTimeline = (() => {
  const validTime = value => typeof value === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
  function day(value, timezone='Asia/Shanghai') {
    if(!validTime(value))return null;
    try {return new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));}
    catch {return new Date(value).toISOString().slice(0,10);}
  }
  function entries(data) {
    const output=[];
    for(const lane of data.lanes||[])for(const window of lane.windows||[]){
      if(validTime(window.reviewedAt))output.push({id:'review:'+window.id,kind:'review',at:window.reviewedAt,laneId:lane.id,windowId:window.id,lane:lane.title,window:window.title,title:window.title,source:window.sourceKind});
      for(const task of window.tasks||[])if(task.status==='done'&&validTime(task.completedAt))output.push({id:'completion:'+task.id,kind:'completion',at:task.completedAt,laneId:lane.id,windowId:window.id,taskId:task.id,lane:lane.title,window:window.title,title:task.title,status:'done'});
    }
    const reviews=new Set(output.filter(e=>e.kind==='review').map(e=>e.windowId+'|'+Date.parse(e.at)));
    for(const event of data.history?.events||[]){
      if(event.kind==='review'){
        const key=event.windowId+'|'+Date.parse(event.reviewedAt);
        if(validTime(event.reviewedAt)&&!reviews.has(key)){output.push({...event,id:'observed:'+event.id,at:event.reviewedAt,source:event.sourceKind});reviews.add(key);}
      }else if(validTime(event.observedAt))output.push({...event,id:'observed:'+event.id,at:event.observedAt});
    }
    return output.sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)||b.id.localeCompare(a.id,undefined,{numeric:true}));
  }
  function scheduleGroups(tasks) {
    const validDay = v => typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
    const scheduled=[],pending=[],archived=[];
    for(const task of tasks){
      if(task.status==='cancelled')continue;
      const a=validDay(task.startsOn),b=validDay(task.dueOn);
      if((a||b)&&!(a&&b&&task.startsOn>task.dueOn))scheduled.push(task);
      else (task.status==='done'?archived:pending).push(task);
    }
    return {scheduled,pending,archived};
  }
  return {entries,day,scheduleGroups};
})();
