/** Explicit profile-local archive configuration. */
import z from '@deepseek-ai/schemastery'
import {isAbsolute,join} from 'node:path'
import {identifier,type PeerId,type AccountId,type NetworkId,type TenantId} from 'dsh-im-kit'
/** Parsed operator settings. */
export interface Config{enabled:boolean;directory:string;tenants:string[];allowAnyTenant:boolean;networks:string[];accounts:string[];allowAnyAccount:boolean;groups:string[];privatePeers:string[];maxPending:number;maxOpenScopes:number;busyMs:number;requestTimeoutMs:number;startupMs:number;shutdownMs:number}
/** Archive is disabled and all scopes are excluded until explicitly configured. */
export const Config:z<Config>=z.object({enabled:z.boolean().default(false),directory:z.string().default(''),tenants:z.array(z.string()).default([]),allowAnyTenant:z.boolean().default(false),networks:z.array(z.string()).default(['onebot11']),accounts:z.array(z.string()).default([]),allowAnyAccount:z.boolean().default(false),groups:z.array(z.string()).default([]),privatePeers:z.array(z.string()).default([]),maxPending:z.number().min(1).max(65536).step(1).default(512),maxOpenScopes:z.number().min(1).max(256).step(1).default(16),busyMs:z.number().min(0).max(10000).step(1).default(1000),requestTimeoutMs:z.number().min(100).max(120000).step(1).default(10000),startupMs:z.number().min(100).max(120000).step(1).default(10000),shutdownMs:z.number().min(100).max(120000).step(1).default(10000)})
/** Validated settings with explicit group and private peer IDs. */
export interface Spec extends Omit<Config,'tenants'|'networks'|'accounts'|'groups'|'privatePeers'>{readonly tenants:ReadonlySet<TenantId>;readonly networks:ReadonlySet<NetworkId>;readonly accounts:ReadonlySet<AccountId>;readonly groups:ReadonlySet<PeerId>;readonly privatePeers:ReadonlySet<PeerId>}
/** @param config - parsed profile settings. @param profile - absolute profile directory. @returns disabled state or resolved archive specification. */
export function resolve(config:Config,profile:string):Spec|null{
 if(!config.enabled)return null
 if(!isAbsolute(profile)||(config.directory&&!isAbsolute(config.directory)))throw new Error('Archive paths must be absolute')
 if(config.busyMs>=config.requestTimeoutMs)throw new Error('Archive busy timeout must be below request timeout')
 const tenants=new Set(config.tenants.map(value=>identifier('im.tenant',value))),networks=new Set(config.networks.map(value=>identifier('im.network',value))),accounts=new Set(config.accounts.map(value=>identifier('im.account',value))),groups=new Set(config.groups.map(value=>identifier('im.peer',value))),privatePeers=new Set(config.privatePeers.map(value=>identifier('im.peer',value)))
 if(tenants.size!==config.tenants.length||networks.size!==config.networks.length||accounts.size!==config.accounts.length||groups.size!==config.groups.length||privatePeers.size!==config.privatePeers.length)throw new Error('Duplicate archive selection')
 if((!config.allowAnyTenant&&!tenants.size)||!networks.size||(!config.allowAnyAccount&&!accounts.size)||(!groups.size&&!privatePeers.size))throw new Error('Archive tenant, network, account and scope selections are required')
 return{...config,directory:config.directory||join(profile,'data','qq-archive'),tenants,networks,accounts,groups,privatePeers}
}
