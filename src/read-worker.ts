/** Archive-owned, isolated read of one versioned conversation. */
import {DatabaseSync} from 'node:sqlite'
import {createHash} from 'node:crypto'
import {lstatSync} from 'node:fs'
import {join} from 'node:path'
import {parentPort,workerData} from 'node:worker_threads'
import {scopeKey} from 'dsh-im-kit'
import {ArchiveReadError as HistoryError,workerSchema} from './read-wire.ts'
import {inputSchema as sourceSchema} from './wire.ts'
import type {ArchiveMatch as HistoryMatch} from './read-types.ts'

const port=parentPort
if(!port)throw new Error('Archive read worker requires a parent port')
function requireFile(path:string,directory:boolean):void{
 try{const info=lstatSync(path);if(info.isSymbolicLink()||(directory?!info.isDirectory():!info.isFile()))throw new HistoryError('invalid-data')}
 catch(error){if(error instanceof Error&&'code' in error&&error.code==='ENOENT')throw new HistoryError('missing');throw error}
}
try{
 const input=workerSchema.parse(workerData),key=scopeKey(input.scope),base=join(input.directory,'scopes'),file=join(base,createHash('sha256').update(key).digest('hex')+'.sqlite3')
 requireFile(input.directory,true);requireFile(base,true);requireFile(file,false)
 const db=new DatabaseSync(file,{readOnly:true})
 try{
  db.exec('PRAGMA busy_timeout='+input.busyMs);db.exec('PRAGMA query_only=ON');db.exec('BEGIN')
  const app=Number(db.prepare('PRAGMA application_id').get()?.['application_id']),version=Number(db.prepare('PRAGMA user_version').get()?.['user_version'])
  if(app!==0x44534152||version!==1)throw new HistoryError('schema-unsupported')
  if(db.prepare('SELECT scope_key FROM archive_scope WHERE id=1').get()?.['scope_key']!==key)throw new HistoryError('invalid-data')
  const page=input.before?'WHERE (received_at,message_id)<(?,?)':''
  const sql=`SELECT received_at,message_id,length(CAST(input_json AS BLOB)) AS record_bytes,CASE WHEN length(CAST(input_json AS BLOB))<=? THEN input_json ELSE NULL END AS payload FROM messages ${page} ORDER BY received_at DESC,message_id DESC LIMIT ?`
  const stmt=db.prepare(sql),args=input.before?[input.maxRecordBytes,input.before.receivedAt,input.before.messageId,input.maxScan+1]:[input.maxRecordBytes,input.maxScan+1]
  const matches:HistoryMatch[]=[];let scanned=0,scannedBytes=0,bytes=0,partial=false,more=false,last:{receivedAt:number;messageId:string}|null=null
  for(const row of stmt.iterate(...args)){
   if(scanned>=input.maxScan||matches.length>=input.limit){more=true;break}
   if(typeof row['received_at']!=='number'||!Number.isSafeInteger(row['received_at'])||row['received_at']<0||typeof row['message_id']!=='string')throw new HistoryError('invalid-data')
   if(typeof row['record_bytes']!=='number'||!Number.isSafeInteger(row['record_bytes'])||row['record_bytes']<0)throw new HistoryError('invalid-data')
   if(scanned>0&&scannedBytes+row['record_bytes']>input.maxScanBytes){more=true;break}
   scanned++;last={receivedAt:row['received_at'],messageId:row['message_id']}
   scannedBytes+=row['record_bytes'];if(row['record_bytes']>input.maxScanBytes){partial=true;continue}
   if(row['payload']===null){partial=true;continue}
   if(typeof row['payload']!=='string')throw new HistoryError('invalid-data')
   let json:unknown;try{json=JSON.parse(row['payload'])}catch(error){throw new HistoryError('invalid-data')}
   const parsed=sourceSchema.safeParse(json);if(!parsed.success)throw new HistoryError('invalid-data')
   const source=parsed.data
   if(scopeKey(source.scope)!==key||source.messageId!==row['message_id']||source.receivedAt!==row['received_at'])throw new HistoryError('invalid-data')
   if(input.sender!==null&&source.senderId!==input.sender)continue
   const texts:string[]=[];for(const part of source.parts){if(part.type==='text'){if(typeof part.text!=='string')throw new HistoryError('invalid-data');texts.push(part.text)}}
   const text=texts.join('\n');if(input.query&&!text.includes(input.query))continue
   const match:HistoryMatch={messageId:source.messageId,sender:source.senderId,receivedAt:source.receivedAt,sentAt:source.sentAt,text,hasNonText:source.parts.some(part=>part.type!=='text')}
   const size=Buffer.byteLength(JSON.stringify(match),'utf8')
   if(bytes+size>input.maxResultBytes){partial=true;continue}
   matches.push(match);bytes+=size
  }
  db.exec('COMMIT');port.postMessage({ok:true,matches,partial,next:more?last:null})
 }finally{db.close()}
}catch(error){const code=error instanceof HistoryError?error.code:'unavailable';port.postMessage({ok:false,code:['missing','schema-unsupported','invalid-data'].includes(code)?code:'unavailable'})}
port.close()
