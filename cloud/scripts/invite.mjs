// Administrator CLI; run on the deployment owner's computer, never in the browser.
import {randomBytes,createHash} from 'node:crypto';
import {mkdir,writeFile,unlink} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const {values}=parseArgs({options:{site:{type:'string'},output:{type:'string'},config:{type:'string',default:path.join(root,'wrangler.web.jsonc')},remote:{type:'boolean'},local:{type:'boolean'},'persist-to':{type:'string'},hours:{type:'string',default:'24'}}});
if(!values.site||!values.output||Boolean(values.remote)===Boolean(values.local))throw Error('Required: --site URL --output PRIVATE_FILE and exactly one of --remote / --local');
const site=new URL(values.site),hours=Number(values.hours);
if(site.protocol!=='https:'&&!(site.protocol==='http:'&&['127.0.0.1','localhost'].includes(site.hostname)))throw Error('HTTPS required outside loopback');
if(site.username||site.password||!Number.isFinite(hours)||hours<1||hours>168)throw Error('Invalid site or validity (1–168 hours)');
const output=path.resolve(values.output);await mkdir(path.dirname(output),{recursive:true});
const token=randomBytes(32).toString('hex'),hash=createHash('sha256').update(token).digest('hex'),expires=Math.floor(Date.now()/1000)+Math.floor(hours*3600);
// Reserve private output first; never silently overwrite an existing invitation.
await writeFile(output,JSON.stringify({url:site.origin+'/login#invite='+token,expiresAt:new Date(expires*1000).toISOString()},null,2)+'\n',{flag:'wx',mode:0o600});
const sql=output+'.sql';
try{
  await writeFile(sql,`INSERT INTO invitations(token_hash,expires_at) VALUES('${hash}',${expires});\n`,{flag:'wx',mode:0o600});
  const args=[path.join(root,'node_modules','wrangler','bin','wrangler.js'),'d1','execute','DB','--config',values.config,'--file',sql,values.remote?'--remote':'--local'];
  if(values['persist-to'])args.push('--persist-to',values['persist-to']);
  execFileSync(process.execPath,args,{cwd:root,stdio:['ignore','pipe','pipe']});
  console.log('Invitation saved to '+output+' (expires '+new Date(expires*1000).toISOString()+')');
}catch(error){await unlink(output);throw Error('Invitation could not be created: '+String(error.stderr||error.message))}finally{await unlink(sql).catch(()=>{})}
