/** Opt-in archive of selected normalized messaging events. */
import type {Context} from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-app-boot'
import type {} from 'dsh-im-kit/cordis'
import type {InboundMessage} from 'dsh-im-kit'
import {Config,resolve,type Spec} from './config.ts'
import {ArchiveStore} from './store.ts'
import {ArchiveError} from './wire.ts'
export {Config}
export type {Config as ArchiveConfig} from './config.ts'
/** Native plugin identity. */
export const name='qq-archive'
/** Profile ownership is required even when the transport is absent. */
export const inject=['profileContext']
/** Host-only counts; messages and identifiers are never exposed by this service. */
export interface ArchiveStatus{readonly attached:boolean;readonly pending:number;readonly stored:number;readonly duplicates:number;readonly conflicts:number;readonly failures:number;readonly lastError:string|null}
/** Host status service; no model tool or archive query is registered. */
export interface ArchiveService{status():ArchiveStatus}
declare module '@deepseek-ai/cordis'{interface Context{readonly qqArchive:ArchiveService}}
/** @param spec - selected tenant, account and conversation scopes. @param input - trusted normalized event. @returns whether the event is eligible for archiving. */
export function selected(spec:Spec,input:InboundMessage):boolean{
 const {account,kind,peerId}=input.scope
 return (spec.allowAnyTenant||spec.tenants.has(account.tenantId))&&spec.networks.has(account.networkId)&&(spec.allowAnyAccount||spec.accounts.has(account.accountId))&&(kind==='group'?spec.groups.has(peerId):spec.privatePeers.has(peerId))
}
/** @param ctx - DSH context. @param config - operator settings. @returns installation completion. */
export async function apply(ctx:Context,config:Config):Promise<void>{
 const spec=resolve(config,ctx.profileContext.dir);if(!spec)return
 if(ctx.get('qqArchive'))throw new Error('Another archive service is already installed')
 const store=await ArchiveStore.open(spec)
 ctx.effect(()=>()=>store.close())
 let attached=false,stored=0,duplicates=0,conflicts=0,failures=0,lastError:string|null=null
 ctx.effect(()=>ctx.provide('qqArchive',{status:()=>({attached,pending:store.pendingCount(),stored,duplicates,conflicts,failures,lastError})}))
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
