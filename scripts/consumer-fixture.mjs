/** Run in a fresh consumer; inputs and persisted messages are synthetic. */
import assert from 'node:assert/strict'
import {mkdtemp,readdir} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {DatabaseSync} from 'node:sqlite'
import {Context} from '@deepseek-ai/cordis'
import {ImRuntime,identifier} from 'dsh-im-kit'
import * as archive from 'dsh-qq-archive'
import Control,{Config as ControlConfig} from 'dsh-qq-archive/control'
const dir=await mkdtemp(join(resolve('.'),'synthetic-archive-')),im=new ImRuntime(),ctx=new Context(),id=(domain,value)=>identifier(`im.${domain}`,value)
const source={scope:{account:{tenantId:id('tenant','tenant-test'),networkId:id('network','onebot11'),accountId:id('account','account-test')},kind:'group',peerId:id('peer','group-test')},messageId:id('message','message-test'),senderId:id('user','sender-test'),sentAt:100,receivedAt:200,directedToBot:false,parts:[{type:'text',text:'synthetic consumer'}]}
const settings=archive.Config({enabled:true,directory:dir,tenants:['tenant-test'],accounts:['account-test'],groups:['group-test']})
const entry={options:{id:'qq-archive',name:'dsh-qq-archive',config:settings},disabled:false,fiber:{effectiveConfig:settings,state:2}}
const services=ctx.plugin({name:'synthetic-consumer-services',apply(child){child.effect(()=>child.provide('profileContext',{dir}));child.effect(()=>child.provide('im',im));child.effect(()=>child.provide('configEditor',{entries:()=>[entry]}))}});await services.await()
const fiber=ctx.plugin(archive,settings);await fiber.await()
const control=ctx.plugin(Control,ControlConfig({}));await control.await()
assert.deepEqual(await im.publish(source),{accepted:1,failed:0});assert.deepEqual(await im.publish(source),{accepted:1,failed:0})
const state=await ctx.qqArchiveControl.describe();assert.equal(state.active,true);assert.equal(state.stored,1);assert.equal(state.duplicates,1)
await assert.rejects(ctx.qqArchiveControl.save({revision:state.revision,patch:{maxPending:2}}),error=>error.details?.reason==='busy')
await control.dispose();await fiber.dispose();await services.dispose();await im.close()
const file=(await readdir(join(dir,'scopes'))).find(name=>name.endsWith('.sqlite3'));assert.ok(file)
const db=new DatabaseSync(join(dir,'scopes',file),{readOnly:true});assert.equal(db.prepare('SELECT count(*) AS count FROM messages').get().count,1);db.close()
console.log(JSON.stringify({passed:true,stored:1,duplicates:1,activeEditRefused:true,realQqMessagesSent:0}))
