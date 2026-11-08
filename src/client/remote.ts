/** Strict Client descriptors for owner-only archive configuration. */
import type {RemoteResult,TypertRemoteContribution} from '@deepseek-ai/dsh-typert-protocol/types'
import type {Snapshot,SaveRequest} from '../control-types.ts'
import {saveSchema,snapshotSchema} from '../control-codecs.ts'
declare module '@deepseek-ai/dsh-typert-protocol/types'{interface TypertRemoteNamespaceMap{
 /** Archive owner settings. */
 qqArchiveControl:{describe():Promise<RemoteResult<Snapshot>>;save(request:SaveRequest):Promise<RemoteResult<Snapshot>>}
}}
/** Native remote operations for the archive page. */
export const remote:TypertRemoteContribution={package:'dsh-qq-archive',descriptors:['describe','save'].map(method=>({id:`qqArchiveControl/${method}`,service:'qqArchiveControl',namespace:'qqArchiveControl',method,invocation:{kind:'direct'},parameters:method==='describe'?[]:[{name:'request',wire:'request',source:'json',codec:{mode:'strict',typeSymbol:'dsh-qq-archive#saveRequest',create:()=>saveSchema}}],result:{mode:'strict',typeSymbol:'dsh-qq-archive#snapshot',create:()=>snapshotSchema}}))}
