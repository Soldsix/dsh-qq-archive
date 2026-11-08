/** Validation of archive query requests and worker replies. */
import {z} from 'zod'
import {isAbsolute} from 'node:path'
import {identifier} from 'dsh-im-kit'
const raw=z.string().refine(x=>x.trim()!==''&&!/[\u0000-\u001f\u007f]/u.test(x))
const tenant=raw.transform(x=>identifier('im.tenant',x)),network=raw.transform(x=>identifier('im.network',x)),account=raw.transform(x=>identifier('im.account',x)),peer=raw.transform(x=>identifier('im.peer',x)),user=raw.transform(x=>identifier('im.user',x)),message=raw.transform(x=>identifier('im.message',x))
const timestamp=z.number().int().nonnegative().safe()
/** Exact account and conversation selected by trusted Host code. */
export const scopeSchema=z.strictObject({account:z.strictObject({tenantId:tenant,networkId:network,accountId:account}),kind:z.enum(['group','private']),peerId:peer})
/** Decrypted pagination position. */
export const positionSchema=z.strictObject({receivedAt:timestamp,messageId:message})
/** Requests contain no filesystem locations. */
export const readRequestSchema=z.strictObject({scope:scopeSchema,sender:z.nullable(user),query:z.string().max(256),limit:z.number().int().min(1).max(100),maxScan:z.number().int().min(1).max(10000),maxScanBytes:z.number().int().min(1024).max(268435456),maxRecordBytes:z.number().int().min(1024).max(67108864),maxResultBytes:z.number().int().min(1024).max(16777216),before:z.nullable(positionSchema)})
/** Storage location is supplied only by the owning archive. */
export const workerSchema=readRequestSchema.extend({directory:z.string().refine(isAbsolute),busyMs:z.number().int().min(0).max(10000)})
const match=z.strictObject({messageId:message,sender:user,receivedAt:timestamp,sentAt:timestamp,text:z.string(),hasNonText:z.boolean()})
/** Worker output carries no filesystem paths or source errors. */
export const responseSchema=z.discriminatedUnion('ok',[z.strictObject({ok:z.literal(true),matches:z.array(match),partial:z.boolean(),next:z.nullable(positionSchema)}),z.strictObject({ok:z.literal(false),code:z.enum(['missing','schema-unsupported','invalid-data','unavailable'])})])
/** Sanitized read failures never contain source text, query text or paths. */
export type ArchiveReadFailure='invalid-data'|'forbidden'|'capacity'|'timeout'|'cancelled'|'closed'|'missing'|'schema-unsupported'|'unavailable'
/** A bounded read failed without changing the archive. */
export class ArchiveReadError extends Error{constructor(readonly code:ArchiveReadFailure){super('Archive read: '+code)}}
