/** DSH-only synthetic provider and acceptance probe; no external messages are sent. */
import assert from 'node:assert/strict'
import {writeFile,readFile} from 'node:fs/promises'
import {setTimeout as delay} from 'node:timers/promises'
import {createRequire} from 'node:module'
import {pathToFileURL} from 'node:url'
import {dirname,resolve} from 'node:path'
const require=createRequire(import.meta.url),owner=createRequire(require.resolve('dsh-qq-archive/package.json')),kit=owner.resolve('dsh-im-kit/package.json'),metadata=JSON.parse(await readFile(kit,'utf8'))
const {identifier,ImRuntime}=await import(pathToFileURL(resolve(dirname(kit),metadata.main)).href)
export const name='synthetic-archive-fixture'
export function apply(ctx,config){
 const im=new ImRuntime()
 ctx.effect(()=>ctx.provide('im',im));ctx.effect(()=>()=>im.close())
 ctx.inject(['qqArchiveControl','sdkSessionActivation','typertGateway','remoteAccess'],child=>{const task=probe(child,config);child.effect(()=>async()=>{await task})})
}
async function probe(ctx,config){
 const checks=[],id=(domain,value)=>identifier(`im.${domain}`,value);let observed
 try{
  const deadline=Date.now()+15000
  while(!ctx.get('qqArchive')?.status().attached){assert.ok(Date.now()<deadline,'Archive service did not become active');await delay(20)}
  const source={scope:{account:{tenantId:id('tenant','tenant-test'),networkId:id('network','onebot11'),accountId:id('account','account-test')},kind:'group',peerId:id('peer','group-test')},messageId:id('message','message-test'),senderId:id('user','sender-test'),sentAt:100,receivedAt:200,directedToBot:false,parts:[{type:'text',text:'native synthetic message'}]}
  assert.deepEqual(await ctx.im.publish(source),{accepted:1,failed:0});assert.deepEqual(await ctx.im.publish(source),{accepted:1,failed:0})
  const excluded={...source,scope:{...source.scope,peerId:id('peer','excluded-group')}}
  assert.deepEqual(await ctx.im.publish(excluded),{accepted:0,failed:0})
  checks.push('scope-selection-and-deduplication')
  const page=await ctx.get('qqArchive').read({scope:source.scope,sender:source.senderId,query:'synthetic',limit:2,before:null,maxScan:10,maxScanBytes:4096,maxRecordBytes:4096,maxResultBytes:4096},new AbortController().signal)
  assert.deepEqual(page.matches.map(item=>item.text),['native synthetic message']);assert.equal(ctx.get('qqArchive').status().activeReads,0);checks.push('owned-bounded-read-service')
  const control=ctx.qqArchiveControl,state=await control.describe();observed={state,serviceVisibleToFixture:Boolean(ctx.get('qqArchive')),serviceVisibleToControl:Boolean(control.ctx.get('qqArchive')),serviceStoredByControl:Boolean(control.archive)};assert.equal(state.active,true,'status must report the running archive');assert.equal(state.stored,1);assert.equal(state.duplicates,1)
  await assert.rejects(ctx.qqArchiveControl.save({revision:state.revision,patch:{maxPending:2}}),error=>error.details?.reason==='busy')
  checks.push('active-settings-are-not-restarted')
  ctx.effect(()=>ctx.remoteAccess.registerPolicy('archive-test-guest',{bindings:()=>[{resource:{kind:'global'},role:{name:'archive-qa',resource:'global',actions:['qqArchiveControl/describe','qqArchiveControl/save']}}]}))
  const guest={id:'archive-test-guest',ctx,principal:{kind:'archive-test-guest'},signal:new AbortController().signal,interactions:'none',async dispose(){}}
  for(const [method,args] of [['describe',{}],['save',{request:{revision:state.revision,patch:{maxPending:2}}}]])await assert.rejects(ctx.typertGateway.invoke({namespace:'qqArchiveControl',method,args,peer:guest,signal:guest.signal}),error=>error.code==='qq-archive/control'&&error.details.reason==='forbidden')
  checks.push('guest-cannot-read-or-edit-private-settings')
  const paused=await control.save({revision:state.revision,patch:{enabled:false}});assert.equal(paused.config.enabled,false)
  assert.deepEqual(await ctx.im.publish({...source,messageId:id('message','during-pause')}),{accepted:0,failed:0})
  const changed=await control.save({revision:paused.revision,patch:{groups:['group-test','group-other']}})
  const resumed=await control.save({revision:changed.revision,patch:{enabled:true}});assert.equal(resumed.config.enabled,true)
  const ready=Date.now()+15000;while(!ctx.get('qqArchive')?.status().attached){assert.ok(Date.now()<ready);await delay(20)}
  assert.deepEqual(await ctx.im.publish({...source,messageId:id('message','after-resume')}),{accepted:1,failed:0})
  checks.push('pause-edit-resume-through-dsh-config-editor')
  await writeFile(config.resultPath,JSON.stringify({passed:true,checks,realQqMessagesSent:0})+'\n')
 }catch(error){await writeFile(config.resultPath,JSON.stringify({passed:false,checks,error:{message:error.message},observed,realQqMessagesSent:0})+'\n')}
}
