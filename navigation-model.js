globalThis.TaskmapRoutes=(()=>{
  function parse(hash){
    const [path,query='']=(String(hash).replace(/^#/,'')||'/overview').split('?');
    const params=new URLSearchParams(query);
    if(['overview','timeline','windows'].some(p=>path==='/'+p))return {page:path.slice(1),overview:true,params};
    if(path==='/tasks')return {page:'tasks',overview:false,laneId:null,params};
    try {if(path.startsWith('/module/')&&path.length>8)return {page:'module',overview:false,laneId:decodeURIComponent(path.slice(8)),params};}catch{}
    return {page:'missing',overview:false,invalid:true,params};
  }
  function parent(hash){
    const view=parse(hash),p=new URLSearchParams(view.params);
    if(view.invalid)return '#/overview';
    if(p.has('task')){p.delete('task');return (view.laneId?'#/module/'+encodeURIComponent(view.laneId):'#/tasks')+(p.size?'?'+p:'');}
    if(view.page==='module'&&p.has('window'))return '#/module/'+encodeURIComponent(view.laneId);
    return '#/overview';
  }
  function switchProject(url,id){
    const next=new URL(url),view=parse(next.hash);next.searchParams.set('project',id);
    next.hash=['timeline','windows','tasks'].includes(view.page)?'/'+view.page:'/overview';
    return next.href;
  }
  return {parse,parent,switchProject};
})();
