/** Strict JSON codecs for owner-only archive settings. */
import * as z from 'zod/mini'
import type {Settings} from './fields.ts'
import type {SaveRequest,Snapshot} from './control-types.ts'
const config=z.strictObject({enabled:z.boolean(),directory:z.string(),tenants:z.array(z.string()),allowAnyTenant:z.boolean(),networks:z.array(z.string()),accounts:z.array(z.string()),allowAnyAccount:z.boolean(),groups:z.array(z.string()),privatePeers:z.array(z.string()),maxPending:z.int(),maxRecordBytes:z.int(),maxInflightBytes:z.int(),maxOpenScopes:z.int(),busyMs:z.int(),requestTimeoutMs:z.int(),startupMs:z.int(),shutdownMs:z.int()} satisfies {[Key in keyof Settings]:z.ZodMiniType<Settings[Key]>})
const revision=z.string().check(z.regex(/^[a-f0-9]{64}$/))
/** Revision-checked patch from the Client. */
export const saveSchema:z.ZodMiniType<SaveRequest>=z.strictObject({revision,patch:z.pipe(z.partial(config),z.transform(value=>Object.fromEntries(Object.entries(value).filter(([,item])=>item!==undefined)) as Partial<Settings>))})
/** No messages or sender identities are part of the status snapshot. */
export const snapshotSchema:z.ZodMiniType<Snapshot>=z.strictObject({config,revision,active:z.boolean(),attached:z.boolean(),pending:z.int(),stored:z.int(),duplicates:z.int(),conflicts:z.int(),failures:z.int(),lastError:z.nullable(z.string()),entryDisabled:z.boolean(),refreshMs:z.int().check(z.minimum(250),z.maximum(60000))})
