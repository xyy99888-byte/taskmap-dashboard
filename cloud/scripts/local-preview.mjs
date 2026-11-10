// Local development only. Never bundled into Worker deployments.
// Uses one fictional identity on loopback so the portal and pairing can be tested.
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {Miniflare} from 'miniflare';
import {webApi,syncApi} from '../src/worker.mjs';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const runtime=new Miniflare({modules:true,script:'export default {fetch(){return new Response("test")}}',compatibilityDate:'2026-07-01',d1Databases:['DB']});
const DB=await runtime.getD1Database('DB');
const sql=await readFile(path.join(root,'migrations','0001_cloud.sql'),'utf8');
for(const statement of sql.split(';').map(x=>x.trim()).filter(Boolean))await DB.prepare(statement).run();
const user={id:'preview-alice',email:'演示账号（本地测试，无公网登录）'};
const files={'/':['index.html','text/html'],'/portal.js':['portal.js','text/javascript'],'/portal.css':['portal.css','text/css'],'/dashboard/':['dashboard/index.html','text/html'],'/app.js':['app.js','text/javascript'],'/style.css':['style.css','text/css']};
const server=http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://127.0.0.1:8770');
    let response;
    if(url.pathname.startsWith('/api/')||url.pathname.startsWith('/v1/')){
      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      const request=new Request(url,{method:req.method,headers:req.headers,body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(chunks)});
      response=url.pathname.startsWith('/api/')?await webApi(request,{DB},user):await syncApi(request,{DB});
    }else{
      const file=files[url.pathname];
      response=file?new Response(await readFile(path.join(root,'dist',file[0])),{headers:{'Content-Type':file[1]+'; charset=utf-8'}}):new Response('Not found',{status:404});
    }
    res.writeHead(response.status,{'Cache-Control':'no-store',...Object.fromEntries(response.headers)});
    res.end(Buffer.from(await response.arrayBuffer()));
  }catch(error){res.writeHead(error.status||500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:error.message}))}
});
server.listen(8770,'127.0.0.1',()=>console.log('Fictional local preview: http://127.0.0.1:8770/'));
async function stop(){server.close();await runtime.dispose();process.exit(0)}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
