import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,readdir} from 'node:fs/promises'
import {resolve as absolute,join} from 'node:path'
import {DatabaseSync} from 'node:sqlite'
import {createHash} from 'node:crypto'
import {identifier,scopeKey,ImRuntime} from 'dsh-im-kit'
import {Context} from '@deepseek-ai/cordis'
import {resolve} from '../dist/config.js'
import {ArchiveStore} from '../dist/store.js'
import {selected} from '../dist/index.js'
import * as plugin from '../dist/index.js'

const id=(domain,value)=>identifier(`im.${domain}`,value)
const config=(directory,extra={})=>({enabled:true,directory,tenants:['tenant-a'],allowAnyTenant:false,networks:['onebot11'],accounts:['account-a'],allowAnyAccount:false,groups:['group-a','group-b'],privatePeers:['private-a'],maxPending:128,maxRecordBytes:4194304,maxInflightBytes:33554432,maxOpenScopes:1,busyMs:100,requestTimeoutMs:2000,startupMs:3000,shutdownMs:3000,...extra})
const input=(message='message-a',peer='group-a',account='account-a')=>({scope:{account:{tenantId:id('tenant','tenant-a'),networkId:id('network','onebot11'),accountId:id('account',account)},kind:'group',peerId:id('peer',peer)},messageId:id('message',message),senderId:id('user','person-a'),sentAt:100,receivedAt:110,directedToBot:false,parts:[{type:'text',text:'synthetic line one\nline two'},{type:'image',attachmentId:id('attachment','image-a')}]})
async function setup(extra={}){const root=absolute('.test-artifacts');await import('node:fs/promises').then(fs=>fs.mkdir(root,{recursive:true}));const dir=await mkdtemp(join(root,'archive-'));const spec=resolve(config(dir,extra),dir);assert.ok(spec);return{dir,spec,store:await ArchiveStore.open(spec)}}

test('disabled and unselected scopes create no archive',()=>{
 assert.equal(resolve(config('',{enabled:false}),''),null)
 assert.throws(()=>resolve(config(absolute('.test-artifacts'),{groups:[],privatePeers:[]}),absolute('.')))
 const spec=resolve(config(absolute('.test-artifacts')),absolute('.'))
 assert.ok(selected(spec,input()))
 assert.equal(selected(spec,input('one','group-c')),false)
 assert.equal(selected(spec,input('one','group-a','account-b')),false)
 assert.equal(selected(spec,{...input(),scope:{...input().scope,account:{...input().scope.account,tenantId:id('tenant','tenant-b')}}}),false)
})

test('persist complete source, deduplicate and reject identity conflict',async()=>{
 const {dir,store}=await setup()
 const source=input()
 assert.equal(await store.append(source),'stored')
 assert.equal(await store.append({...source,receivedAt:999}),'duplicate')
 assert.equal(await store.append({...source,parts:[{type:'text',text:'different'}]}),'conflict')
 await store.close()
 const files=await readdir(join(dir,'scopes'));const database=new DatabaseSync(join(dir,'scopes',files.find(name=>name.endsWith('.sqlite3'))),{readOnly:true})
 const rows=database.prepare('SELECT input_json FROM messages').all();assert.equal(rows.length,1);assert.deepEqual(JSON.parse(rows[0].input_json),source);database.close()
})

test('separate conversations with same message identity survive LRU reopen',async()=>{
 const {dir,spec,store}=await setup()
 assert.equal(await store.append(input('same','group-a')),'stored')
 assert.equal(await store.append(input('same','group-b')),'stored')
 assert.equal(await store.append(input('same','group-a')),'duplicate')
 await store.close()
 assert.equal((await readdir(join(dir,'scopes'))).filter(x=>x.endsWith('.sqlite3')).length,2)
 const reopened=await ArchiveStore.open(spec);assert.equal(await reopened.append(input('same','group-b')),'duplicate');await reopened.close()
})

test('concurrent deliveries insert once and closing joins writes',async()=>{
 const {store}=await setup()
 const operations=Array.from({length:30},()=>store.append(input()))
 const closing=store.close()
 const results=await Promise.all(operations)
 assert.equal(results.filter(x=>x==='stored').length,1);assert.equal(results.filter(x=>x==='duplicate').length,29)
 await closing
 await assert.rejects(store.append(input()),error=>error.code==='closed')
})

test('invalid input is rejected without storing partial source',async()=>{
 const {store}=await setup()
 await assert.rejects(store.append({...input(),sentAt:-1}),error=>error.code==='invalid-data')
 await assert.rejects(store.append(input()),error=>error.code==='invalid-data')
 await store.close()
})

test('foreign database is refused without changing its records',async()=>{
 const {dir,store}=await setup()
 const filename=createHash('sha256').update(scopeKey(input().scope)).digest('hex')+'.sqlite3'
 const db=new DatabaseSync(join(dir,'scopes',filename));db.exec('CREATE TABLE foreign_data(value TEXT); INSERT INTO foreign_data VALUES (\'untouched\')');db.close()
 await assert.rejects(store.append(input()),error=>error.code==='schema-unsupported')
 await store.close()
 const check=new DatabaseSync(join(dir,'scopes',filename),{readOnly:true});assert.equal(check.prepare('SELECT value FROM foreign_data').get().value,'untouched');check.close()
})

test('timed-out worker writes keep occupying the bounded queue',async()=>{
 const {dir,store}=await setup({busyMs:900,requestTimeoutMs:1100,maxPending:2,shutdownMs:4000})
 await store.append(input('seed'))
 const filename=(await readdir(join(dir,'scopes'))).find(x=>x.endsWith('.sqlite3'))
 const lock=new DatabaseSync(join(dir,'scopes',filename));lock.exec('BEGIN IMMEDIATE')
 const first=store.append(input('first')).catch(error=>error.code)
 const second=store.append(input('second')).catch(error=>error.code)
 assert.equal(await first,'unavailable')
 assert.equal(await second,'timeout')
 assert.equal(store.pendingCount(),1)
 const third=store.append(input('third')).catch(error=>error.code)
 await assert.rejects(store.append(input('fourth')),error=>error.code==='capacity')
 lock.exec('ROLLBACK');lock.close()
 assert.equal(await third,'stored')
 await store.close()
 const db=new DatabaseSync(join(dir,'scopes',filename),{readOnly:true});assert.equal(db.prepare('SELECT count(*) AS count FROM messages WHERE message_id=\'second\'').get().count,1);db.close()
})

test('record and outstanding byte limits refuse writes without truncating',async()=>{
 const {store}=await setup({maxRecordBytes:1024,maxInflightBytes:1024})
 const huge={...input('huge'),parts:[{type:'text',text:'x'.repeat(2000)}]}
 await assert.rejects(store.append(huge),error=>error.code==='too-large')
 const medium={...input('medium'),parts:[{type:'text',text:'x'.repeat(600)}]}
 const first=store.append(medium)
 await assert.rejects(store.append({...medium,messageId:id('message','other')}),error=>error.code==='capacity')
 assert.equal(await first,'stored');await store.close()
})

test('Cordis subscription archives only selected events and disposes cleanly',async()=>{
 const root=absolute('.test-artifacts');await import('node:fs/promises').then(fs=>fs.mkdir(root,{recursive:true}));const dir=await mkdtemp(join(root,'mount-'))
 const ctx=new Context(),im=new ImRuntime()
 const services=ctx.plugin({name:'synthetic-archive-services',apply(child){child.effect(()=>child.provide('profileContext',{dir}));child.effect(()=>child.provide('im',im))}});await services.await()
 const fiber=ctx.plugin(plugin,plugin.Config(config(join(dir,'db'))));await fiber.await()
 assert.equal(ctx.qqArchive.status().attached,true)
 assert.deepEqual(await im.publish(input()),{accepted:1,failed:0})
 assert.deepEqual(await im.publish(input('excluded','group-c')),{accepted:0,failed:0})
 assert.deepEqual(await im.publish(input()),{accepted:1,failed:0})
 assert.equal(ctx.qqArchive.status().stored,1);assert.equal(ctx.qqArchive.status().duplicates,1)
 await fiber.dispose();assert.deepEqual(await im.publish(input('after-stop')),{accepted:0,failed:0})
 await services.dispose();await im.close()
})

test('a blocked archive write does not delay an independent chat listener',async()=>{
 const root=absolute('.test-artifacts');await import('node:fs/promises').then(fs=>fs.mkdir(root,{recursive:true}));const dir=await mkdtemp(join(root,'chat-parallel-'))
 const ctx=new Context(),im=new ImRuntime();let chats=0
 const services=ctx.plugin({name:'parallel-chat-fixture',apply(child){child.effect(()=>child.provide('profileContext',{dir}));child.effect(()=>child.provide('im',im))}});await services.await()
 const fiber=ctx.plugin(plugin,plugin.Config(config(join(dir,'db'),{busyMs:900,requestTimeoutMs:1100})));await fiber.await()
 const detach=im.subscribe(()=>{chats++},()=>true)
 await im.publish(input('seed'));assert.equal(chats,1)
 const file=(await readdir(join(dir,'db','scopes'))).find(name=>name.endsWith('.sqlite3'))
 const lock=new DatabaseSync(join(dir,'db','scopes',file));lock.exec('BEGIN IMMEDIATE')
 const delivered=im.publish(input('blocked'))
 await new Promise(resolve=>setImmediate(resolve));assert.equal(chats,2)
 assert.equal(ctx.qqArchive.status().pending,1)
 lock.exec('ROLLBACK');lock.close();assert.deepEqual(await delivered,{accepted:2,failed:0})
 await detach();await fiber.dispose();await services.dispose();await im.close()
})
