import {mkdir, copyFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.dirname(fileURLToPath(import.meta.url));
await mkdir(path.join(root,'dist','dashboard'),{recursive:true});
for(const file of ['app.js','navigation-model.js','navigation.js','navigation.css','timeline-model.js','timeline.js','style.css','favicon.svg'])await copyFile(path.join(root,'..',file),path.join(root,'dist',file));
await copyFile(path.join(root,'..','index.html'),path.join(root,'dist','dashboard','index.html'));
for(const file of ['index.html','portal.js','portal.css','login.html','auth.js'])await copyFile(path.join(root,'portal',file),path.join(root,'dist',file));
console.log('Built public assets. No project data or local configuration included.');
