/** Owner-only settings; pause is the only permitted active-runtime change. */
import {createHash} from 'node:crypto'
import type {Context} from '@deepseek-ai/cordis'
import type {Entry} from '@deepseek-ai/cordis-plugin-loader'
import z from '@deepseek-ai/schemastery'
import {Remote,RemoteError,TypertRemoteService,principalOf} from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-config-editor'
import type {} from '@deepseek-ai/dsh-app-boot'
import type {ArchiveService} from './index.ts'
import {Config as RuntimeConfig,resolve} from './config.ts'
import {FIELDS,type Settings} from './fields.ts'
import {saveSchema} from './control-codecs.ts'
import type {Failure,Snapshot} from './control-types.ts'
/** Target profile row and status polling interval. */
export interface ControlConfig{targetEntryId:string;statusRefreshMs:number}
/** Settings remain visible when archive execution is disabled. */
export const Config:z<ControlConfig>=z.object({targetEntryId:z.string().default('qq-archive'),statusRefreshMs:z.number().min(250).max(60000).step(1).default(3000)})
declare module '@deepseek-ai/cordis'{interface Context{readonly qqArchiveControl:ArchiveControl}}
const fail=(reason:Failure)=>new RemoteError('qq-archive/control','Archive settings operation could not complete',{reason})
function parse(value:unknown,profile:string):Settings{
 try{if(typeof value!=='object'||!value||Array.isArray(value)||Object.keys(value).some(key=>!Object.hasOwn(FIELDS,key)))throw fail('invalid');const config=z.resolve(value,RuntimeConfig,{})[0];resolve(config,profile);return config}catch(error){throw fail('invalid')}
}
function revision(value:Settings):string{return createHash('sha256').update(JSON.stringify(Object.keys(FIELDS).map(key=>[key,value[key as keyof Settings]]))).digest('hex')}
/** Configuration is available only to the profile owner. */
export class ArchiveControl extends TypertRemoteService{
 static inject=['configEditor','profileContext']
 static Config=Config
 private readonly lifetime=new AbortController()
 private tail:Promise<void>=Promise.resolve()
 private archive:ArchiveService|undefined
 constructor(ctx:Context,private readonly config:ControlConfig){super(ctx,'qqArchiveControl');if(!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(config.targetEntryId))throw new Error('Invalid target entry');ctx.inject(['qqArchive'],child=>{const service=child.qqArchive;this.archive=service;child.effect(()=>()=>{if(this.archive===service)this.archive=undefined})});ctx.effect(()=>async()=>{this.lifetime.abort();await this.tail})}
 private owner():void{if(principalOf(this.ctx.invocation))throw fail('forbidden');if(this.lifetime.signal.aborted||this.ctx.invocation?.signal.aborted)throw fail('cancelled')}
 private target():Entry{const all=this.ctx.configEditor.entries(),entry=all.find(value=>value.options.id===this.config.targetEntryId);if(!entry||entry.options.name!=='dsh-qq-archive'||!entry.fiber||all.some(value=>value!==entry&&value.options.name==='dsh-qq-archive'))throw fail('unavailable');return entry}
 private snapshot():Snapshot{
  const entry=this.target(),config=parse(entry.fiber?.effectiveConfig,this.ctx.profileContext.dir),service=this.archive,status=service?.status()
  return{config:structuredClone(config),revision:revision(config),active:Boolean(service),attached:status?.attached??false,pending:status?.pending??0,stored:status?.stored??0,duplicates:status?.duplicates??0,conflicts:status?.conflicts??0,failures:status?.failures??0,lastError:status?.lastError??null,entryDisabled:entry.disabled,refreshMs:this.config.statusRefreshMs}
 }
 private serial<T>(operation:()=>Promise<T>):Promise<T>{this.owner();const task=this.tail.then(()=>{if(this.lifetime.signal.aborted)throw fail('cancelled');return operation()});this.tail=task.then(()=>{},()=>{});return task}
 /** @returns saved settings and non-content counters. */
 @Remote
 describe():Promise<Snapshot>{return this.serial(async()=>this.snapshot())}
 /** @param request - revision and changed fields. @returns updated settings. */
 @Remote
 save(request:unknown):Promise<Snapshot>{
  this.owner();let edit:ReturnType<typeof saveSchema.parse>;try{edit=saveSchema.parse(request)}catch(error){throw fail('invalid')}
  return this.serial(async()=>{
   const entry=this.target(),current=parse(entry.fiber?.effectiveConfig,this.ctx.profileContext.dir)
   if(revision(current)!==edit.revision)throw fail('conflict')
   parse({...current,...edit.patch},this.ctx.profileContext.dir)
   const pause=current.enabled&&edit.patch.enabled===false&&Object.keys(edit.patch).length===1
   if(entry.disabled||!pause&&(this.archive||current.enabled))throw fail('busy')
   let reason:Failure='apply-failed'
   try{await this.ctx.configEditor.edit(entry,raw=>{
    if(revision(parse(entry.fiber?.effectiveConfig,this.ctx.profileContext.dir))!==edit.revision){reason='conflict';throw fail(reason)}
    if(this.archive&&!pause||entry.disabled){reason='busy';throw fail(reason)}
    return{...raw,...edit.patch}
   })}catch(error){throw fail(reason)}
   return this.snapshot()
  })
 }
}
export default ArchiveControl
