/** Structured source validation at the worker boundary. */
import {z} from 'zod'
import {isAbsolute} from 'node:path'
import {identifier,type InboundMessage} from 'dsh-im-kit'
const rawId=z.string().refine(value=>value.trim()!==''&&!/[\u0000-\u001f\u007f]/u.test(value))
const user=rawId.transform(value=>identifier('im.user',value)),message=rawId.transform(value=>identifier('im.message',value)),attachment=rawId.transform(value=>identifier('im.attachment',value))
const time=z.number().int().nonnegative()
/** Complete normalized source, with opaque media references and no local paths. */
export const inputSchema:z.ZodType<InboundMessage>=z.strictObject({
 scope:z.strictObject({account:z.strictObject({tenantId:rawId.transform(value=>identifier('im.tenant',value)),networkId:rawId.transform(value=>identifier('im.network',value)),accountId:rawId.transform(value=>identifier('im.account',value))}),kind:z.enum(['group','private']),peerId:rawId.transform(value=>identifier('im.peer',value))}),
 messageId:message,senderId:user,sentAt:time,receivedAt:time,directedToBot:z.boolean(),
 parts:z.array(z.discriminatedUnion('type',[
  z.strictObject({type:z.literal('text'),text:z.string()}),z.strictObject({type:z.literal('mention'),userId:user}),z.strictObject({type:z.literal('reply'),messageId:message}),
  z.strictObject({type:z.literal('image'),attachmentId:attachment}),z.strictObject({type:z.literal('audio'),attachmentId:attachment}),z.strictObject({type:z.literal('video'),attachmentId:attachment}),
  z.strictObject({type:z.literal('file'),attachmentId:attachment,name:z.string()}),z.strictObject({type:z.literal('forward'),resourceId:rawId.transform(value=>identifier('im.forward',value))}),
  z.strictObject({type:z.literal('card'),format:z.enum(['json','xml']),content:z.string()}),z.strictObject({type:z.literal('unsupported'),segmentType:z.string()}),
 ])),
})
/** Errors contain only operational codes. */
export const errorCode=z.enum(['unavailable','timeout','startup-failed','schema-unsupported','invalid-data','closed','worker-exited','capacity'])
/** Worker setup uses an explicit directory and capacity limits. */
export const workerConfig=z.strictObject({directory:z.string().refine(isAbsolute),maxOpenScopes:z.number().int().min(1).max(256),busyMs:z.number().int().min(0).max(10000)})
const id=z.number().int().positive()
/** Worker accepts no filesystem path or SQL supplied by a message. */
export const command=z.discriminatedUnion('method',[z.strictObject({id,method:z.literal('append'),input:inputSchema}),z.strictObject({id,method:z.literal('close')})])
/** Parent validates worker replies before resolving requests. */
export const reply=z.union([
 z.strictObject({type:z.literal('ready')}),z.strictObject({type:z.literal('startup-error'),code:errorCode}),
 z.strictObject({type:z.literal('result'),id,ok:z.literal(true),value:z.enum(['stored','duplicate','conflict','closed'])}),
 z.strictObject({type:z.literal('result'),id,ok:z.literal(false),code:errorCode}),z.strictObject({type:z.literal('fatal'),code:errorCode}),
])
/** Errors never embed source bodies or paths. */
export class ArchiveError extends Error{constructor(readonly code:z.infer<typeof errorCode>){super('Archive: '+code)}}
