import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const context={};
vm.runInNewContext(readFileSync(new URL('../../timeline-model.js',import.meta.url),'utf8'),context);
const model=context.TaskTimeline;
const fixture=()=>({lanes:[{id:'m',title:'模块',windows:[{id:'w',title:'窗口',reviewedAt:'2026-11-09T18:00:00Z',updatedAt:'2026-11-10T06:00:00Z',tasks:[{id:'done',title:'旧成果',status:'done'},{id:'todo',title:'待办',status:'todo'}]}]}],history:{events:[{id:'1',kind:'baseline',observedAt:'2026-11-10T03:00:00Z',total:2,done:1}]}});
test('persisted reviews use source dates, deduplicate the latest reference and retain older reviews',()=>{
 const data=fixture();
 data.history.events.push({id:'2',kind:'review',windowId:'w',laneId:'m',reviewedAt:'2026-11-09T18:00:00Z',observedAt:'2026-11-10T03:00:00Z'});
 data.history.events.push({id:'3',kind:'review',windowId:'w',laneId:'m',reviewedAt:'2026-11-08T18:00:00Z',observedAt:'2026-11-10T03:00:00Z'});
 const reviews=model.entries(data).filter(e=>e.kind==='review');assert.equal(reviews.length,2);
 assert.ok(reviews.some(e=>e.at==='2026-11-08T18:00:00Z'));
});
test('reviewed and observed times never manufacture completion or schedule dates',()=>{
 const data=fixture(),before=JSON.stringify(data),events=model.entries(data);
 assert.equal(events.length,2);assert.equal(events.filter(e=>e.kind==='completion').length,0);
 assert.ok(events.some(e=>e.kind==='review'&&e.at===data.lanes[0].windows[0].reviewedAt));
 assert.equal(JSON.stringify(data),before);assert.equal(model.day('2026-11-09T18:00:00Z','Asia/Shanghai'),'2026-11-10');
 assert.equal(model.day('2026-11-09T18:00:00'),null);
});
test('only explicit completed timestamps on done tasks create actual-completion events',()=>{
 const data=fixture(),tasks=data.lanes[0].windows[0].tasks;
 tasks[0].completedAt='2026-11-08T08:00:00+08:00';tasks[1].completedAt='2026-11-07T08:00:00+08:00';
 const events=model.entries(data).filter(e=>e.kind==='completion');
 assert.equal(events.length,1);assert.equal(events[0].taskId,'done');
 assert.equal(events[0].at,tasks[0].completedAt);
});
test('unscheduled backlog excludes completed and cancelled tasks; valid plans survive unrelated completion warning',()=>{
 const tasks=[{id:'a',status:'done'},{id:'b',status:'todo'},{id:'c',status:'cancelled'},
 {id:'d',status:'in_progress',startsOn:'2026-11-12',dueOn:'2026-11-10'},
 {id:'e',status:'todo',startsOn:'2026-02-30'},
 {id:'f',status:'todo',dueOn:'2026-11-12',scheduleWarning:'完成时间无效'}];
 const result=model.scheduleGroups(tasks);
 assert.equal(result.pending.map(t=>t.id).join(','),'b,d,e');
 assert.equal(result.archived.map(t=>t.id).join(','),'a');
 assert.equal(result.scheduled.map(t=>t.id).join(','),'f');
});
test('empty and older snapshots work without a history collector',()=>{
 assert.equal(model.entries({lanes:[]}).length,0);
 const data=fixture();delete data.history;data.lanes[0].windows[0].reviewedAt=null;
 assert.equal(model.entries(data).length,0);
});
