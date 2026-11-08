/** Bounded worker RPC; timed-out writes are reported as uncertain and never retried. */
import {Worker} from 'node:worker_threads'
import {z} from 'zod'
import type {InboundMessage} from 'dsh-im-kit'
import type {Spec} from './config.ts'
import {ArchiveError,reply} from './wire.ts'

type Outcome='stored'|'duplicate'|'conflict'
interface Pending{method:'append'|'close';bytes:number;settled:boolean;resolve:(value:unknown)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}
/** Owned SQLite worker and outstanding write tracking. */
export class ArchiveStore{
 private readonly worker:Worker
 private readonly pending=new Map<number,Pending>()
 private readonly done:Promise<number>
 private readonly ready:Promise<void>
 private serial=0
 private pendingBytes=0
 private fault:ArchiveError|undefined
 private exited=false
 private stopping:Promise<void>|undefined
 private constructor(private readonly spec:Spec){
  this.worker=new Worker(new URL('./worker.js',import.meta.url),{workerData:{directory:spec.directory,maxOpenScopes:spec.maxOpenScopes,busyMs:spec.busyMs}})
  this.done=new Promise(resolve=>this.worker.once('exit',code=>{this.exited=true;this.fail(new ArchiveError('worker-exited'));resolve(code)}))
  this.ready=new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{this.fail(new ArchiveError('timeout'));reject(this.fault)},spec.startupMs)
   const failure=(error:Error)=>{clearTimeout(timer);reject(error)}
   this.worker.once('error',()=>failure(new ArchiveError('startup-failed')))
   void this.done.then(()=>failure(new ArchiveError('worker-exited')))
   this.worker.on('message',(raw:unknown)=>{
    const parsed=reply.safeParse(raw);if(!parsed.success){const error=new ArchiveError('invalid-data');this.fail(error);failure(error);return}
    const value=parsed.data
    if(value.type==='ready'){clearTimeout(timer);resolve();return}
    if(value.type==='startup-error'||value.type==='fatal'){const error=new ArchiveError(value.code);this.fail(error);failure(error);return}
    const request=this.pending.get(value.id);if(!request)return
    this.pending.delete(value.id);this.pendingBytes-=request.bytes;clearTimeout(request.timer)
    if(!request.settled){if(value.ok)request.resolve(value.value);else request.reject(new ArchiveError(value.code))}
   })
  })
  this.worker.on('error',()=>this.fail(new ArchiveError('worker-exited')))
 }
 /** @param spec - resolved settings. @returns a ready worker. */
 static async open(spec:Spec):Promise<ArchiveStore>{const store=new ArchiveStore(spec);try{await store.ready;return store}catch(error){await store.close();throw error}}
 private fail(error:ArchiveError):void{this.fault??=error;for(const item of this.pending.values()){clearTimeout(item.timer);item.reject(this.fault)}this.pending.clear();this.pendingBytes=0}
 private request(method:'append'|'close',input?:InboundMessage,bytes=0):Promise<unknown>{
  if(this.fault)return Promise.reject(this.fault)
  if(this.stopping&&method!=='close')return Promise.reject(new ArchiveError('closed'))
  const id=++this.serial
  return new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{const item=this.pending.get(id);if(item){item.settled=true;reject(new ArchiveError('timeout'))}},this.spec.requestTimeoutMs)
   this.pending.set(id,{method,bytes,settled:false,resolve,reject,timer});this.pendingBytes+=bytes
   try{this.worker.postMessage(method==='append'?{id,method,input}:{id,method})}catch(error){this.pending.delete(id);this.pendingBytes-=bytes;clearTimeout(timer);reject(new ArchiveError('unavailable'))}
  })
 }
 /** @param input - normalized source preserved without truncation. @returns durable insert, duplicate or identity conflict. */
 append(input:InboundMessage):Promise<Outcome>{
  if(this.stopping)return Promise.reject(new ArchiveError('closed'))
  if(this.pendingCount()>=this.spec.maxPending)return Promise.reject(new ArchiveError('capacity'))
  let bytes:number
  try{bytes=Buffer.byteLength(JSON.stringify(input),'utf8')}catch(error){return Promise.reject(new ArchiveError('invalid-data'))}
  if(bytes>this.spec.maxRecordBytes)return Promise.reject(new ArchiveError('too-large'))
  if(this.pendingBytes+bytes>this.spec.maxInflightBytes)return Promise.reject(new ArchiveError('capacity'))
  return this.request('append',input,bytes).then(value=>{const parsed=z.enum(['stored','duplicate','conflict']).safeParse(value);if(!parsed.success)throw new ArchiveError('invalid-data');return parsed.data})
 }
 /** @returns outstanding write count without source bodies. */
 pendingCount():number{return [...this.pending.values()].filter(item=>item.method==='append').length}
 /** @returns completion after outstanding work and worker exit, or a visible timeout. */
 close():Promise<void>{
  if(this.stopping)return this.stopping
  this.stopping=(async()=>{
   if(this.exited)return
   let expired=false
   const deadline=setTimeout(()=>{expired=true;void this.worker.terminate()},this.spec.shutdownMs)
   try{if(!this.fault&&!expired)await this.request('close');await this.done;if(expired)throw new ArchiveError('timeout')}
   finally{clearTimeout(deadline);this.fail(new ArchiveError('closed'));if(!this.exited){await this.worker.terminate();await this.done}}
  })()
  return this.stopping
 }
}
