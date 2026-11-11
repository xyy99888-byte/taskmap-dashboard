import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const context={URL,URLSearchParams};
vm.runInNewContext(readFileSync(new URL('../../navigation-model.js',import.meta.url),'utf8'),context);
const routes=context.TaskmapRoutes;
test('primary views and encoded module links parse without losing filters',()=>{
 for(const page of ['overview','timeline','tasks','windows'])assert.equal(routes.parse('#/'+page).page,page);
 const view=routes.parse('#/module/'+encodeURIComponent('产品 / 接口')+'?window=w&task=t&q=a%26b');
 assert.equal(view.laneId,'产品 / 接口');assert.equal(view.params.get('q'),'a&b');assert.equal(view.params.get('window'),'w');
 assert.equal(routes.parse('').page,'overview');
});
test('unknown and malformed links provide a safe parent',()=>{
 for(const hash of ['#/unknown','#/module/','#/module/%E0%A4%A']){
 assert.equal(routes.parse(hash).invalid,true);assert.equal(routes.parent(hash),'#/overview');}
});
test('direct task/window links return to their own hierarchy',()=>{
 assert.equal(routes.parent('#/tasks?task=t&status=done'),'#/tasks?status=done');
 assert.equal(routes.parent('#/module/m?window=w&task=t'),'#/module/m?window=w');
 assert.equal(routes.parent('#/module/m?window=w'),'#/module/m');
 assert.equal(routes.parent('#/timeline'),'#/overview');
});
test('project switching keeps page but discards foreign module/window/filter ids',()=>{
 for(const page of ['timeline','windows','tasks']){
 const url=new URL(routes.switchProject('https://example.test/dashboard/?project=old#/'+page+'?window=w&filter=todo','next'));
 assert.equal(url.searchParams.get('project'),'next');assert.equal(url.hash,'#/'+page);
 }
 assert.equal(new URL(routes.switchProject('https://example.test/dashboard/?project=old#/module/m?task=t','next')).hash,'#/overview');
});
