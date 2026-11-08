/** Opt-in archive of selected normalized messaging events. */
import type {Context} from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-app-boot'
import type {} from 'dsh-im-kit/cordis'
import type {InboundMessage} from 'dsh-im-kit'
import {Config,resolve,selectedScope,type Spec} from './config.ts'
import {ArchiveStore} from './store.ts'
import {ArchiveReader} from './reader.ts'
import type {ArchiveReaderService} from './read-types.ts'
export type * from './read-types.ts'
export {ArchiveReadError,type ArchiveReadFailure} from './read-wire.ts'
import {ArchiveError} from './wire.ts'
export {Config}
export type {Config as ArchiveConfig} from './config.ts'
/** Native plugin identity. */
export const name='qq-archive'
/** Profile ownership is required even when the transport is absent. */
export const inject=['profileContext']
/** Host-only counts; messages and identifiers are never exposed by this service. */
export interface ArchiveStatus{readonly activeReads:number;readonly attached:boolean;readonly pending:number;readonly stored:number;readonly duplicates:number;readonly conflicts:number;readonly failures:number;readonly lastError:string|null}
/** Trusted Host API. Reads require explicit owner enablement and caller authorization; no model tool is registered. */
export interface ArchiveService extends ArchiveReaderService{
 /** @returns counters without source text or identifiers. */
 status():ArchiveStatus
}
declare module '@deepseek-ai/cordis'{interface Context{readonly qqArchive:ArchiveService}}
/** @param spec - selected tenant, account and conversation scopes. @param input - trusted normalized event. @returns whether the event is eligible for archiving. */
export function selected(spec:Spec,input:InboundMessage):boolean{
 return selectedScope(spec,input.scope)
}
/** @param ctx - DSH context. @param config - operator settings. @returns installation completion. */
export async function apply(ctx:Context,config:Config):Promise<void>{
 const spec=resolve(config,ctx.profileContext.dir);if(!spec)return
 if(ctx.get('qqArchive'))throw new Error('Another archive service is already installed')
 const store=await ArchiveStore.open(spec)
 const reader=new ArchiveReader(spec)
 ctx.effect(()=>async()=>{const results=await Promise.allSettled([reader.close(),store.close()]);for(const result of results)if(result.status==='rejected')throw result.reason})
 let attached=false,stored=0,duplicates=0,conflicts=0,failures=0,lastError:string|null=null
 ctx.effect(()=>ctx.provide('qqArchive',{read:(request,signal)=>reader.read(request,signal),status:()=>({activeReads:reader.activeCount(),attached,pending:store.pendingCount(),stored,duplicates,conflicts,failures,lastError})}))
 ctx.inject(['im'],child=>{
  attached=true;child.effect(()=>()=>{attached=false})
  child.effect(()=>child.im.subscribe(async input=>{
   try{
    const outcome=await store.append(input)
    if(outcome==='stored')stored++
    else if(outcome==='duplicate')duplicates++
    else{conflicts++;throw new ArchiveError('invalid-data')}
   }catch(error){failures++;lastError=error instanceof ArchiveError?error.code:'unavailable';throw new ArchiveError(error instanceof ArchiveError?error.code:'unavailable')}
  },input=>selected(spec,input)))
 })
}
