/** Native owner page keeps in-progress edits separate from polled status. */
import {useEffect,useId,useRef,useState,type ReactNode} from 'react'
import {Button,Input,Switch,Toast} from '@deepseek-ai/dsh-client-ui-primitives'
import type {HostObservable,InjectFace,PropsLocale,PropsRuntime} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import {FIELDS,type Settings} from '../fields.ts'
import {saveSchema} from '../control-codecs.ts'
import type {Snapshot,SaveRequest,Failure} from '../control-types.ts'
/** Localized failure without remote diagnostics. */
export class PageProblem extends Error{constructor(readonly reason:Failure){super(reason)}}
/** Owner operations for archive settings. */
export interface PageFace{readonly read:()=>Promise<Snapshot>;readonly save:(request:SaveRequest)=>Promise<Snapshot>;readonly notify:(text:string,success:boolean)=>void}
/** App-wide transient notification. */
export interface Notice{readonly id:number;readonly text:string;readonly success:boolean}
/** Observable notification and dismissal. */
export interface NoticeFace{readonly hooks:{readonly notice:HostObservable<Notice|null>};readonly dismiss:(id:number)=>void}
/** @param props - notification subscription. @returns native toast when present. */
export function NoticeHost({useNotice,dismiss}:InjectFace<NoticeFace>):ReactNode{const value=useNotice(item=>item);return value?<Toast key={value.id} text={value.text} {...value.success?{tone:'success' as const}:{}} onDone={()=>dismiss(value.id)}/>:null}
/** @param props - slot view, locale and owner operations. @returns archive settings page. */
export function Page({view,...props}:PropsRuntime<'plugins.bundle.config'>&PropsLocale<'qqArchive'>&PageFace):ReactNode{return view==='page'?<Form {...props}/>:null}
function Form({t,read,save,notify}:PropsLocale<'qqArchive'>&PageFace):ReactNode{
 const id=useId(),alive=useRef(true),editing=useRef(false),writing=useRef(false),sequence=useRef(0)
 const [snapshot,setSnapshot]=useState<Snapshot|null>(null),[baseline,setBaseline]=useState<Snapshot|null>(null),[draft,setDraft]=useState<Partial<Record<keyof Settings,string|boolean>>>({}),[failed,setFailed]=useState(false),[busy,setBusy]=useState(false),[refresh,setRefresh]=useState(0)
 const dirty=Object.keys(draft).length>0;editing.current=dirty
 function accept(value:Snapshot,reset:boolean){setSnapshot(value);if(reset||!editing.current&&!writing.current){setBaseline(value);setDraft({})}}
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;sequence.current++}},[])
 useEffect(()=>{let current=true,timer:ReturnType<typeof setTimeout>|undefined
  const poll=async()=>{const turn=++sequence.current;try{const value=await read();if(current&&turn===sequence.current){accept(value,false);setFailed(false)}if(current)timer=setTimeout(()=>{void poll()},value.refreshMs)}catch(error){if(current&&turn===sequence.current)setFailed(true)}}
  void poll();return()=>{current=false;sequence.current++;clearTimeout(timer)}
 },[read,refresh])
 async function submit():Promise<void>{
  if(!baseline||writing.current||!dirty)return
  const entries: Array<[string,string|boolean|number|string[]]>=[]
  for(const key of Object.keys(FIELDS) as (keyof Settings)[]){const raw=draft[key];if(raw===undefined)continue
   const type=FIELDS[key]
   if(type==='boolean'){if(typeof raw!=='boolean'){notify(t('invalid'),false);return}entries.push([key,raw])}
   else if(typeof raw!=='string'){notify(t('invalid'),false);return}
   else if(type==='list')entries.push([key,raw.split(/\r?\n/u).map(value=>value.trim()).filter(Boolean)])
   else if(type==='number'){if(!/^\d+$/u.test(raw.trim())||!Number.isSafeInteger(Number(raw))){notify(t('invalid'),false);return}entries.push([key,Number(raw)])}
   else entries.push([key,raw])
  }
  const parsed=saveSchema.safeParse({revision:baseline.revision,patch:Object.fromEntries(entries)});if(!parsed.success){notify(t('invalid'),false);return}
  writing.current=true;sequence.current++;setBusy(true)
  try{const result=await save(parsed.data);notify(t('saved'),true);if(alive.current){accept(result,true);setRefresh(value=>value+1)}}catch(error){notify(error instanceof PageProblem?t(error.reason):t('unavailable'),false)}finally{writing.current=false;if(alive.current)setBusy(false)}
 }
 if(!snapshot||!baseline)return<section className="qqarchive-page">{failed?<div role="alert"><p>{t('load')}</p><Button onClick={()=>setRefresh(value=>value+1)}>{t('refresh')}</Button></div>:<span role="status">{t('loading')}</span>}</section>
 const locked=snapshot.active||baseline.config.enabled||snapshot.entryDisabled
 const canPause=baseline.config.enabled&&!snapshot.entryDisabled,pauseOnly=canPause&&Object.keys(draft).length===1&&draft.enabled===false
 const field=(key:keyof Settings)=>{
  const type=FIELDS[key],value=draft[key]??baseline.config[key],disabled=busy||locked&&!(key==='enabled'&&canPause)
  if(type==='boolean')return<div className="qqarchive-field" key={key}><span>{t(key)}</span><Switch label={t(key)} disabled={disabled} checked={value===true} onChange={next=>setDraft(previous=>({...previous,[key]:next}))}/></div>
  const shown=Array.isArray(value)?value.join('\n'):String(value)
  return<div className="qqarchive-field" key={key}><label htmlFor={`${id}-${key}`}>{t(key)}</label>{type==='list'?<textarea id={`${id}-${key}`} disabled={disabled} value={shown} onChange={event=>{const next=event.currentTarget.value;setDraft(previous=>({...previous,[key]:next}))}}/>:<Input id={`${id}-${key}`} type={type==='number'?'number':'text'} disabled={disabled} value={shown} onChange={event=>{const next=event.currentTarget.value;setDraft(previous=>({...previous,[key]:next}))}}/>}</div>
 }
 return<section className="qqarchive-page"><p>{t('intro')}</p><p aria-live="polite">{t(snapshot.active?'active':'inactive')} · {t(snapshot.attached?'attached':'detached')} · {t('pending')}: {snapshot.pending} · {t('activeReads')}: {snapshot.activeReads} · {t('stored')}: {snapshot.stored} · {t('duplicates')}: {snapshot.duplicates} · {t('conflicts')}: {snapshot.conflicts} · {t('failures')}: {snapshot.failures}</p>{snapshot.lastError&&<p role="alert">{t('lastError')}: {snapshot.lastError}</p>}{snapshot.entryDisabled&&<p>{t('entryDisabled')}</p>}{failed&&<p role="alert">{t('load')}</p>}<form onSubmit={event=>{event.preventDefault();void submit()}}>{(Object.keys(FIELDS) as (keyof Settings)[]).map(field)}<p>{t('pause')}</p>{dirty&&<p role="status">{t(snapshot.revision===baseline.revision?'dirty':'stale')}</p>}<div className="qqarchive-actions"><Button type="submit" variant="primary" disabled={busy||locked&&!pauseOnly||!dirty}>{t('save')}</Button><Button type="button" disabled={busy||!dirty} onClick={()=>accept(snapshot,true)}>{t('discard')}</Button><Button type="button" disabled={busy} onClick={()=>setRefresh(value=>value+1)}>{t('refresh')}</Button></div></form></section>
}
