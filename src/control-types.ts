/** Owner-only configuration and non-content operational status. */
import type {Settings} from './fields.ts'
import type {} from '@deepseek-ai/dsh-typert-protocol/types'
/** Saved settings and archive counters. */
export interface Snapshot{readonly config:Settings;readonly revision:string;readonly active:boolean;readonly attached:boolean;readonly pending:number;readonly activeReads:number;readonly stored:number;readonly duplicates:number;readonly conflicts:number;readonly failures:number;readonly lastError:string|null;readonly entryDisabled:boolean;readonly refreshMs:number}
/** Update must match the revision the owner reviewed. */
export interface SaveRequest{readonly revision:string;readonly patch:Partial<Settings>}
/** Sanitized configuration error. */
export type Failure='forbidden'|'cancelled'|'invalid'|'conflict'|'unavailable'|'busy'|'apply-failed'
declare module '@deepseek-ai/dsh-typert-protocol/types'{interface RemoteErrorDetailsMap{
 /** No archived source or filesystem path is included in errors. */
 'qq-archive/control':{readonly reason:Failure}
}}
