import test from 'node:test'
import assert from 'node:assert/strict'
import {resolve as absolute} from 'node:path'
import {Context} from '@deepseek-ai/cordis'
import Control,{Config as ControlConfig} from '../dist/control.js'
import {Config} from '../dist/config.js'
import {saveSchema,snapshotSchema} from '../dist/control-codecs.js'

async function mount(t,{active=false,disabled=false,editFailure=false}={}){
 const ctx=new Context(),writes=[],dir=absolute('.test-artifacts'),entry={options:{id:'qq-archive',name:'dsh-qq-archive',config:{}},disabled,fiber:{effectiveConfig:Config(active?{enabled:true,tenants:['tenant-a'],accounts:['account-a'],groups:['group-a']}:{enabled:false}),state:2}}
 const editor={entries:()=>[entry],async edit(target,change){assert.equal(target,entry);const next=change(entry.options.config);if(editFailure)throw Error('synthetic failure');writes.push(next);entry.options.config=next;entry.fiber.effectiveConfig=Config(next)}}
 const services=ctx.plugin({name:'archive-control-fixture',apply(child){child.effect(()=>child.provide('profileContext',{dir}));child.effect(()=>child.provide('configEditor',editor));if(active)child.effect(()=>child.provide('qqArchive',{status:()=>({attached:true,pending:0,stored:1,duplicates:0,conflicts:0,failures:0,lastError:null})}))}});await services.await()
 const fiber=ctx.plugin(Control,ControlConfig({}));await fiber.await();t.after(async()=>{await fiber.dispose();await services.dispose()})
 return{control:ctx.qqArchiveControl,entry,writes}
}
test('owner changes scope settings with revision checks and valid selections',async t=>{
 const {control,writes}=await mount(t),initial=await control.describe()
 assert.equal(snapshotSchema.safeParse(initial).success,true);assert.equal(initial.active,false)
 const saved=await control.save({revision:initial.revision,patch:{tenants:['tenant-a'],accounts:['account-a'],groups:['group-a'],maxPending:9}})
 assert.equal(saved.config.maxPending,9);assert.equal(writes.length,1)
 await assert.rejects(control.save({revision:initial.revision,patch:{enabled:true}}),error=>error.details?.reason==='conflict')
 await assert.rejects(control.save({revision:saved.revision,patch:{enabled:true,busyMs:5000,requestTimeoutMs:1000}}),error=>error.details?.reason==='invalid')
 await assert.rejects(async()=>control.save({revision:saved.revision,patch:{unknown:'secret'}}),error=>error.details?.reason==='invalid')
 assert.equal(saveSchema.safeParse({revision:saved.revision,patch:{unknown:'secret'}}).success,false)
 const enabled=await control.save({revision:saved.revision,patch:{enabled:true}});assert.equal(enabled.config.enabled,true)
})
test('active archive refuses all edits rather than interrupting writes',async t=>{
 const {control,writes,entry}=await mount(t)
 entry.fiber.effectiveConfig=Config({enabled:true,tenants:['tenant-a'],accounts:['account-a'],groups:['group-a']})
 const initial=await control.describe();assert.equal(initial.active,false)
 await assert.rejects(control.save({revision:initial.revision,patch:{maxPending:2}}),error=>error.details?.reason==='busy')
 assert.equal(writes.length,0)
})
test('configuration writes surface editor failures without a silent change',async t=>{
 const {control,writes}=await mount(t,{editFailure:true}),initial=await control.describe()
 await assert.rejects(control.save({revision:initial.revision,patch:{groups:['group-a']}}),error=>error.details?.reason==='apply-failed')
 assert.equal(writes.length,0)
})
test('a running service cannot be reconfigured even if its profile entry is marked disabled',async t=>{
 const {control,writes}=await mount(t,{active:true,disabled:true}),initial=await control.describe()
 assert.equal(initial.active,true);assert.equal(initial.stored,1)
 await assert.rejects(control.save({revision:initial.revision,patch:{maxPending:2}}),error=>error.details?.reason==='busy')
 assert.equal(writes.length,0)
})
test('an active archive may only be paused in a separate save',async t=>{
 const {control,writes}=await mount(t,{active:true}),initial=await control.describe()
 await assert.rejects(control.save({revision:initial.revision,patch:{enabled:false,maxPending:2}}),error=>error.details?.reason==='busy')
 await control.save({revision:initial.revision,patch:{enabled:false}})
 assert.equal(writes.length,1);assert.equal(writes[0].enabled,false);assert.equal(writes[0].maxPending,undefined)
})
