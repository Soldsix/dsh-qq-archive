/** Cancellable read workers owned by the archive, separate from the ingestion worker. */
import {Worker} from 'node:worker_threads'
import {selectedScope,type Spec} from './config.ts'
import type {ArchivePage,ArchiveReadRequest,ArchiveReaderService} from './read-types.ts'
import {ArchiveReadError,readRequestSchema,responseSchema} from './read-wire.ts'
interface Running{readonly done:Promise<void>;readonly stop:(error:ArchiveReadError)=>void}
/** Bounded query admission and awaited worker disposal. No read can interrupt a write. */
export class ArchiveReader implements ArchiveReaderService{
 private readonly running=new Set<Running>()
 private stopping:Promise<void>|undefined
 /** @param spec - storage owner settings, including selected scopes and read ceilings. */
 constructor(private readonly spec:Spec){}
 /** @param input - trusted authorization and requested resource budgets. @param signal - only this read is cancelled. @returns a complete bounded page after worker exit. */
 read(input:ArchiveReadRequest,signal:AbortSignal):Promise<ArchivePage>{
  if(this.stopping)return Promise.reject(new ArchiveReadError('closed'))
  if(!this.spec.readEnabled)return Promise.reject(new ArchiveReadError('forbidden'))
  if(signal.aborted)return Promise.reject(new ArchiveReadError('cancelled'))
  const parsed=readRequestSchema.safeParse(input);if(!parsed.success)return Promise.reject(new ArchiveReadError('invalid-data'))
  const request=parsed.data
  if(!selectedScope(this.spec,request.scope))return Promise.reject(new ArchiveReadError('forbidden'))
  if(request.limit>this.spec.readMaxResults)return Promise.reject(new ArchiveReadError('invalid-data'))
  if(this.running.size>=this.spec.readMaxConcurrent)return Promise.reject(new ArchiveReadError('capacity'))
  const data={...request,directory:this.spec.directory,busyMs:this.spec.busyMs,maxScan:Math.min(request.maxScan,this.spec.readMaxScan),maxScanBytes:Math.min(request.maxScanBytes,this.spec.readMaxScanBytes),maxRecordBytes:Math.min(request.maxRecordBytes,this.spec.maxRecordBytes),maxResultBytes:Math.min(request.maxResultBytes,this.spec.readMaxResultBytes)}
  let worker:Worker;try{worker=new Worker(new URL('./read-worker.js',import.meta.url),{workerData:data})}catch(error){return Promise.reject(new ArchiveReadError('unavailable'))}
  let failure:ArchiveReadError|undefined,page:ArchivePage|undefined,release!:()=>void
  const done=new Promise<void>(resolve=>{release=resolve})
  const stop=(error:ArchiveReadError)=>{failure??=error;void worker.terminate().catch(()=>{/* The error and exit events settle this request and retain ownership until exit. */})}
  const running:Running={done,stop};this.running.add(running)
  return new Promise((resolve,reject)=>{
   const abort=()=>stop(new ArchiveReadError('cancelled'))
   const timer=setTimeout(()=>stop(new ArchiveReadError('timeout')),this.spec.readTimeoutMs)
   worker.once('message',(raw:unknown)=>{
    const result=responseSchema.safeParse(raw);if(!result.success){stop(new ArchiveReadError('invalid-data'));return}
    if(result.data.ok)page={matches:result.data.matches,partial:result.data.partial,next:result.data.next}
    else failure??=new ArchiveReadError(result.data.code)
   })
   worker.once('error',()=>stop(new ArchiveReadError('unavailable')))
   worker.once('exit',code=>{
    clearTimeout(timer);signal.removeEventListener('abort',abort);this.running.delete(running);release()
    if(failure)reject(failure);else if(code!==0||!page)reject(new ArchiveReadError('unavailable'));else resolve(page)
   })
   signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort()
  })
 }
 /** @returns active read workers, including cancelled workers awaiting exit. */
 activeCount():number{return this.running.size}
 /** @returns completion after every owned read worker has exited. */
 close():Promise<void>{
  if(this.stopping)return this.stopping
  this.stopping=Promise.resolve().then(async()=>{const running=[...this.running];for(const task of running)task.stop(new ArchiveReadError('closed'));await Promise.all(running.map(task=>task.done))})
  return this.stopping
 }
}
