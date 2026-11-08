/** One owned worker performs SQLite IO without blocking the Host event loop. */
import {DatabaseSync} from 'node:sqlite'
import {createHash} from 'node:crypto'
import {lstatSync,mkdirSync} from 'node:fs'
import {join} from 'node:path'
import {parentPort,workerData} from 'node:worker_threads'
import {scopeKey,type InboundMessage,type ScopeKey} from 'dsh-im-kit'
import {ArchiveError,command,workerConfig} from './wire.ts'

const APPLICATION_ID=0x44534152,SCHEMA_VERSION=1,port=parentPort
if(!port)throw new Error('Archive worker requires a parent port')
let closed=false
const open=new Map<ScopeKey,DatabaseSync>(),hash=(value:string)=>createHash('sha256').update(value).digest('hex')
let directory='',maxOpenScopes=0,busyMs=0
function rejectLink(path:string):void{try{if(lstatSync(path).isSymbolicLink())throw new ArchiveError('invalid-data')}catch(error){if(!(error instanceof Error&&'code'in error&&error.code==='ENOENT'))throw error}}
function closeAll():void{for(const db of open.values())db.close();open.clear();closed=true}
function database(input:InboundMessage):DatabaseSync{
 const key=scopeKey(input.scope),cached=open.get(key)
 if(cached){open.delete(key);open.set(key,cached);return cached}
 while(open.size>=maxOpenScopes){const oldest=open.keys().next().value;if(oldest!==undefined){const db=open.get(oldest);open.delete(oldest);db?.close()}}
 const path=join(directory,'scopes',hash(key)+'.sqlite3');rejectLink(path)
 const db=new DatabaseSync(path)
 try{
  db.exec('PRAGMA busy_timeout='+busyMs)
  db.exec('BEGIN IMMEDIATE')
  try{
   const version=Number(db.prepare('PRAGMA user_version').get()?.['user_version']),application=Number(db.prepare('PRAGMA application_id').get()?.['application_id'])
   if(version===0&&application===0){
    if(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get())throw new ArchiveError('schema-unsupported')
    db.exec(`CREATE TABLE archive_scope(id INTEGER PRIMARY KEY CHECK(id=1),scope_key TEXT NOT NULL); CREATE TABLE messages(message_id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,input_json TEXT NOT NULL,received_at INTEGER NOT NULL); CREATE INDEX message_time ON messages(received_at,message_id); PRAGMA user_version=${SCHEMA_VERSION}; PRAGMA application_id=${APPLICATION_ID};`)
    db.prepare('INSERT INTO archive_scope(id,scope_key) VALUES(1,?)').run(key)
   }else if(version!==SCHEMA_VERSION||application!==APPLICATION_ID)throw new ArchiveError('schema-unsupported')
   if(db.prepare('SELECT scope_key FROM archive_scope WHERE id=1').get()?.['scope_key']!==key)throw new ArchiveError('invalid-data')
   db.exec('COMMIT')
  }catch(error){db.exec('ROLLBACK');throw error}
  if(db.prepare('PRAGMA journal_mode=WAL').get()?.['journal_mode']!=='wal')throw new ArchiveError('unavailable')
  db.exec('PRAGMA synchronous=FULL');open.set(key,db);return db
 }catch(error){db.close();throw error}
}
function append(input:InboundMessage):'stored'|'duplicate'|'conflict'{
 const db=database(input),fingerprint=hash(JSON.stringify({scope:input.scope,messageId:input.messageId,senderId:input.senderId,sentAt:input.sentAt,directedToBot:input.directedToBot,parts:input.parts}))
 const inserted=db.prepare('INSERT INTO messages(message_id,fingerprint,input_json,received_at) VALUES(?,?,?,?) ON CONFLICT(message_id) DO NOTHING').run(input.messageId,fingerprint,JSON.stringify(input),input.receivedAt)
 if(Number(inserted.changes)===1)return'stored'
 return db.prepare('SELECT fingerprint FROM messages WHERE message_id=?').get(input.messageId)?.['fingerprint']===fingerprint?'duplicate':'conflict'
}
try{
 const config=workerConfig.parse(workerData);directory=config.directory;maxOpenScopes=config.maxOpenScopes;busyMs=config.busyMs
 mkdirSync(directory,{recursive:true,mode:0o700});rejectLink(directory);mkdirSync(join(directory,'scopes'),{recursive:true,mode:0o700});rejectLink(join(directory,'scopes'))
 port.postMessage({type:'ready'})
}catch(error){closed=true;port.postMessage({type:'startup-error',code:error instanceof ArchiveError?error.code:'startup-failed'});port.close()}
if(!closed)port.on('message',(value:unknown)=>{
 const parsed=command.safeParse(value)
 if(!parsed.success){try{closeAll()}catch(error){/* Invalid worker input cannot leave the channel open. */}port.postMessage({type:'fatal',code:'invalid-data'});port.close();return}
 const item=parsed.data
 try{const result=item.method==='append'?append(item.input):(closeAll(),'closed');port.postMessage({type:'result',id:item.id,ok:true,value:result});if(item.method==='close')port.close()}
 catch(error){port.postMessage({type:'result',id:item.id,ok:false,code:error instanceof ArchiveError?error.code:'unavailable'})}
})
