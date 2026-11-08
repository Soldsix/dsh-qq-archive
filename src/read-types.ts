/** Host-only archive reads, with no database paths or model tools. */
import type {ConversationScope,MessageId,UserId} from 'dsh-im-kit'
/** Exclusive pagination position ordered by receipt time and message identity. */
export interface ArchivePosition{readonly receivedAt:number;readonly messageId:MessageId}
/** Trusted Host code must authorize the scope and sender before requesting source text. */
export interface ArchiveReadRequest{readonly scope:ConversationScope;readonly sender:UserId|null;readonly query:string;readonly limit:number;readonly before:ArchivePosition|null;readonly maxScan:number;readonly maxScanBytes:number;readonly maxRecordBytes:number;readonly maxResultBytes:number}
/** Complete text from one source; binary references and paths are excluded. */
export interface ArchiveMatch{readonly messageId:MessageId;readonly sender:UserId;readonly receivedAt:number;readonly sentAt:number;readonly text:string;readonly hasNonText:boolean}
/** Record limits never truncate a match; partial indicates skipped oversized records. */
export interface ArchivePage{readonly matches:readonly ArchiveMatch[];readonly partial:boolean;readonly next:ArchivePosition|null}
/** Storage-owner query API; callers cannot supply SQL or filesystem locations. */
export interface ArchiveReaderService{
 /** @param request - authorized scope, sender and query budgets, bounded again by archive settings. @param signal - cancellation of this read only. @returns a page after its worker has stopped. */
 read(request:ArchiveReadRequest,signal:AbortSignal):Promise<ArchivePage>
}
