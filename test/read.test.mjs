import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,readdir} from 'node:fs/promises'
import {join,resolve as absolute} from 'node:path'
import {DatabaseSync} from 'node:sqlite'
import {Context} from '@deepseek-ai/cordis'
import {identifier,ImRuntime} from 'dsh-im-kit'
import * as plugin from '../dist/index.js'
import {Config,resolve} from '../dist/config.js'
import {ArchiveStore} from '../dist/store.js'
import {ArchiveReader} from '../dist/reader.js'
const id=(name,value)=>identifier('im.'+name,value)
const scope=(peer='group-a')=>({account:{tenantId:id('tenant','tenant-a'),networkId:id('network','onebot11'),accountId:id('account','account-a')},kind:'group',peerId:id('peer',peer)})
const event=(n,sender='alice',text='hello',peer='group-a')=>({scope:scope(peer),messageId:id('message','msg-'+n),senderId:id('user',sender),sentAt:n,receivedAt:n,parts:[{type:'text',text},{type:'image',attachmentId:id('attachment','opaque-ref')}],directedToBot:false})
const query=(extra={})=>({scope:scope(),sender:id('user','alice'),query:'',limit:2,before:null,maxScan:100,maxScanBytes:16777216,maxRecordBytes:4194304,maxResultBytes:524288,...extra})
const signal=()=>new AbortController().signal
async function setup(t,extra={}){
 const base=absolute('.test-artifacts');await mkdir(base,{recursive:true});const dir=await mkdtemp(join(base,'read-'))
 const config=Config({enabled:true,directory:dir,tenants:['tenant-a'],accounts:['account-a'],groups:['group-a','group-b'],readEnabled:true,...extra}),spec=resolve(config,dir),store=await ArchiveStore.open(spec),reader=new ArchiveReader(spec)
 t.after(async()=>{await Promise.all([reader.close(),store.close()])})
 return{dir,spec,store,reader}
}
test('owner read switch and exact archive scopes deny reads without creating conversations',async t=>{
 const {dir,spec,reader}=await setup(t,{readEnabled:false})
 await assert.rejects(reader.read(query(),signal()),error=>error.code==='forbidden')
 const enabled=new ArchiveReader({...spec,readEnabled:true});t.after(()=>enabled.close())
 await assert.rejects(enabled.read(query({scope:scope('other')}),signal()),error=>error.code==='forbidden')
 await assert.rejects(enabled.read(query({scope:{...scope(),account:{...scope().account,accountId:id('account','other')}}}),signal()),error=>error.code==='forbidden')
 assert.deepEqual(await readdir(join(dir,'scopes')),[])
})
test('archive reader returns bounded complete text with exclusive paging and no media references',async t=>{
 const {store,reader}=await setup(t,{readMaxScan:2})
 for(const [n,sender,text] of [[1,'alice','鲸鲸 old'],[2,'bob','secret'],[3,'alice','鲸鲸 new'],[4,'bob','hidden'],[5,'alice','鲸鲸 newest']])await store.append(event(n,sender,text))
 const a=await reader.read(query({query:'鲸鲸'}),signal());assert.deepEqual(a.matches.map(x=>x.text),['鲸鲸 newest']);assert.ok(a.next)
 const b=await reader.read(query({query:'鲸鲸',before:a.next}),signal());assert.deepEqual(b.matches.map(x=>x.text),['鲸鲸 new']);assert.ok(b.next)
 const c=await reader.read(query({query:'鲸鲸',before:b.next}),signal());assert.deepEqual(c.matches.map(x=>x.text),['鲸鲸 old']);assert.equal(c.next,null)
 assert.equal(JSON.stringify([a,b,c]).includes('opaque-ref'),false);assert.equal(a.matches[0].hasNonText,true);assert.equal(reader.activeCount(),0)
})
test('owner result and byte ceilings override larger consumer budgets without truncating text',async t=>{
 const {store,reader}=await setup(t,{readMaxResults:2,readMaxResultBytes:1024})
 await store.append(event(1,'alice','short'));await store.append(event(2,'alice','鲸'.repeat(900)))
 await assert.rejects(reader.read(query({limit:3}),signal()),error=>error.code==='invalid-data')
 const page=await reader.read(query(),signal());assert.equal(page.partial,true);assert.deepEqual(page.matches.map(x=>x.text),['short'])
})
test('scan byte ceiling pages before an uninspected record',async t=>{
 const {store,reader}=await setup(t,{readMaxScanBytes:1024})
 await store.append(event(1,'alice','a'.repeat(500)));await store.append(event(2,'alice','b'.repeat(500)))
 const first=await reader.read(query(),signal());assert.deepEqual(first.matches.map(x=>x.messageId),['msg-2']);assert.ok(first.next)
 const second=await reader.read(query({before:first.next}),signal());assert.deepEqual(second.matches.map(x=>x.messageId),['msg-1']);assert.equal(second.next,null)
})
test('read capacity includes a cancelling worker until exit and ingestion remains available',async t=>{
 const {store,reader}=await setup(t,{readMaxConcurrent:1});await store.append(event(1))
 const cancel=new AbortController(),first=reader.read(query(),cancel.signal),rejected=assert.rejects(first,error=>error.code==='cancelled');cancel.abort()
 await assert.rejects(reader.read(query(),signal()),error=>error.code==='capacity')
 assert.equal(await store.append(event(2)),'stored');await rejected
 assert.equal(reader.activeCount(),0);assert.equal((await reader.read(query(),signal())).matches.length,2)
})
test('close joins reads and writes independently and refuses future reads',async t=>{
 const {store,reader}=await setup(t);await store.append(event(1));const reading=reader.read(query(),signal()),writing=store.append(event(2))
 const rejected=assert.rejects(reading,error=>error.code==='closed');await Promise.all([reader.close(),store.close(),rejected]);assert.equal(await writing,'stored');assert.equal(reader.activeCount(),0)
 await assert.rejects(reader.read(query(),signal()),error=>error.code==='closed')
})
test('multiple selected conversations read concurrently without mixing sources',async t=>{
 const {store,reader}=await setup(t);await Promise.all([store.append(event(1,'alice','one')),store.append(event(1,'alice','two','group-b'))])
 const pages=await Promise.all([reader.read(query(),signal()),reader.read(query({scope:scope('group-b')}),signal())]);assert.deepEqual(pages.map(x=>x.matches[0].text),['one','two'])
})
test('missing archive and foreign schema produce sanitized errors without modifying storage',async t=>{
 const {dir,store,reader}=await setup(t);await assert.rejects(reader.read(query(),signal()),error=>error.code==='missing')
 await store.append(event(1));await store.close();const file=join(dir,'scopes',(await readdir(join(dir,'scopes'))).find(x=>x.endsWith('.sqlite3'))),db=new DatabaseSync(file);db.exec('PRAGMA user_version=999');db.close()
 await assert.rejects(reader.read(query(),signal()),error=>error.code==='schema-unsupported'&&!error.message.includes(dir))
 const check=new DatabaseSync(file,{readOnly:true});assert.equal(check.prepare('PRAGMA user_version').get().user_version,999);check.close()
})
test('deadline terminates a lock-blocked read and retains ownership until exit',async t=>{
 const {dir,store,reader}=await setup(t,{busyMs:900,readTimeoutMs:100});await store.append(event(1));await store.close()
 const file=join(dir,'scopes',(await readdir(join(dir,'scopes'))).find(x=>x.endsWith('.sqlite3'))),lock=new DatabaseSync(file);lock.exec('PRAGMA journal_mode=DELETE');lock.exec('BEGIN EXCLUSIVE')
 try{await assert.rejects(reader.read(query(),signal()),error=>error.code==='timeout');assert.equal(reader.activeCount(),0)}finally{lock.exec('ROLLBACK');lock.close()}
})
test('Cordis archive service owns reading and disposal while transport appends normally',async t=>{
 const {dir,spec}=await setup(t),ctx=new Context(),im=new ImRuntime()
 const base=ctx.plugin({name:'read-service-fixture',apply(child){child.effect(()=>child.provide('profileContext',{dir}));child.effect(()=>child.provide('im',im))}});await base.await()
 const fiber=ctx.plugin(plugin,Config({...spec,tenants:['tenant-a'],networks:['onebot11'],accounts:['account-a'],groups:['group-a'],privatePeers:[],directory:join(dir,'service')}));await fiber.await()
 t.after(async()=>{await fiber.dispose();await base.dispose();await im.close()})
 assert.deepEqual(await im.publish(event(1)),{accepted:1,failed:0});const service=ctx.qqArchive;assert.equal((await service.read(query(),signal())).matches.length,1)
 await fiber.dispose();await assert.rejects(service.read(query(),signal()),error=>error.code==='closed');assert.equal(ctx.get('qqArchive'),undefined)
})
