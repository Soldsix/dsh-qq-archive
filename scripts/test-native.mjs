/** Install and exercise the plugin through an isolated DSH SDK profile. */
import assert from 'node:assert/strict'
import {pnpmScript} from './pnpm.mjs'
import {requiredProfilePeers} from './profile-peers.mjs'
import {spawn} from 'node:child_process'
import {once} from 'node:events'
import {mkdtemp,mkdir,readFile,writeFile,copyFile,realpath} from 'node:fs/promises'
import {join,delimiter,relative,isAbsolute} from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {setTimeout as delay} from 'node:timers/promises'
const root=fileURLToPath(new URL('../',import.meta.url)),runs=join(root,'..','.test-artifacts','archive-native'),resume=process.argv.indexOf('--resume')
await mkdir(runs,{recursive:true})
const area=resume<0?await mkdtemp(join(runs,'native-')):await realpath(process.argv[resume+1])
const owned=relative(runs,area);assert.ok(!owned.startsWith('..')&&!isAbsolute(owned)&&owned.startsWith('native-'),'Resume area must be an isolated native test directory')
const attempt=await mkdtemp(join(area,'attempt-')),home=join(area,'home'),profile='archive-native',profileRoot=join(home,'profiles',profile)
const argument=name=>{const index=process.argv.indexOf(name);assert.ok(index>=0&&process.argv[index+1],'Required '+name);return process.argv[index+1]}
const dsh=await realpath(join(root,'node_modules','@deepseek-ai','dsh','lib','bin.js'))
const manifest=JSON.parse(await readFile(join(root,'package.json'),'utf8'))
const archive=process.argv.includes('--archive')?(/^https:\/\//u.test(argument('--archive'))?argument('--archive'):await realpath(argument('--archive'))):join(root,'artifacts',manifest.name+'-'+manifest.version+'.tgz')
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/KEY|SECRET|TOKEN|PASSWORD|DEEPSEEK_BASE_URL/i.test(key)&&key.toUpperCase()!=='PATH'))
await mkdir(join(area,'temp'),{recursive:true});Object.assign(env,{PATH:join(root,'node_modules','.bin')+delimiter+(process.env.PATH??process.env.Path??''),DSH_HOME:home,TEMP:join(area,'temp'),TMP:join(area,'temp'),DSH_PRIMARY_RUNTIME:'',DSH_SYSTEM_PROMPT:'Synthetic isolated profile.',DEEPSEEK_API_KEY:'synthetic-loopback-only',DEEPSEEK_BASE_URL:'http://127.0.0.1:9/anthropic'})
async function run(argv,cwd){
 const timeout=AbortSignal.timeout(180000),child=spawn(process.execPath,argv,{cwd,env,windowsHide:true,signal:timeout,stdio:['ignore','pipe','pipe']});let output='',failure
 child.stdout.on('data',data=>{output+=data});child.stderr.on('data',data=>{output+=data});child.once('error',error=>{failure=error})
 const [code,signal]=await new Promise(done=>child.once('close',(...values)=>done(values)))
 if(failure)throw failure;assert.equal(signal,null);assert.equal(code,0,output.slice(-1800));return output
}
if(resume<0){
await run([dsh,'--profile',profile,'--from-default-profile','sdk','--dump-config'],area)
const manifest=JSON.parse(await readFile(join(profileRoot,'package.json'),'utf8')),own=JSON.parse(await readFile(join(root,'package.json'),'utf8'))
manifest.pnpm={...manifest.pnpm,overrides:own.overrides};await writeFile(join(profileRoot,'package.json'),JSON.stringify(manifest,null,2)+'\n')
await writeFile(join(profileRoot,'.npmrc'),'package-import-method=copy\nstore-dir='+join(runs,'pnpm-store').replaceAll('\\','/')+'\n')
const pnpm=await pnpmScript(root)
const boot=JSON.parse(await readFile(join(root,'node_modules','@deepseek-ai','dsh-app-boot','package.json'),'utf8')),bootPeers=Object.entries(boot.peerDependencies).map(([name,version])=>name+'@'+version)
const peers=[...bootPeers,'@deepseek-ai/cordis@~4.1.0','@deepseek-ai/cordis-plugin-loader@~1.1.0','@deepseek-ai/schemastery@~3.19.0',...['app-boot','brand','config-editor','typert-protocol','sandbox','llm-deepseek','llm-deepseek-api-key'].map(name=>'@deepseek-ai/dsh-'+name+'@0.2.2-rc.1')]
await run([pnpm,'add','@deepseek-ai/dsh@0.2.2-rc.1',...peers,'--ignore-scripts'],profileRoot)
await run([dsh,'plugin','--profile',profile,'add',archive],area)
for(;;){const missing=await requiredProfilePeers(profileRoot);if(!missing.length)break;await run([pnpm,'add',...missing,'--ignore-scripts'],profileRoot)}
}
const fixture=join(profileRoot,'archive-fixture.mjs'),resultPath=join(attempt,'result.json');await copyFile(join(root,'scripts','native-fixture.mjs'),fixture)
await writeFile(join(profileRoot,'cordis.patch.yml'),JSON.stringify([{id:'qq-archive',config:{enabled:true,readEnabled:true,directory:join(attempt,'db'),tenants:['tenant-test'],accounts:['account-test'],groups:['group-test']}},{insert:[{id:'archive-fixture',name:pathToFileURL(fixture).href,config:{resultPath}}]}],null,2)+'\n')
const bin=join(profileRoot,'node_modules','@deepseek-ai','dsh','lib','bin.js'),child=spawn(process.execPath,[bin,'--profile',profile],{cwd:area,env,windowsHide:true,stdio:['pipe','pipe','pipe']})
let stdout='',stderr='',exitCode;child.stderr.on('data',data=>{stderr+=data});child.stdout.on('data',data=>{stdout+=data});const exit=once(child,'close').then(([code,signal])=>{exitCode=code;return{code,signal}})
try{
 let result;const deadline=Date.now()+60000
 while(Date.now()<deadline){try{result=JSON.parse(await readFile(resultPath,'utf8'));break}catch(error){if(error.code!=='ENOENT')throw error}assert.equal(exitCode,undefined,'DSH exited before the probe: '+stderr.slice(-5000));await delay(40)}
 assert.ok(result,'DSH probe timed out');assert.equal(result.passed,true,JSON.stringify(result.error))
 child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'shutdown',params:{}})+'\n');const stopped=await Promise.race([exit,delay(15000,undefined,{ref:false}).then(()=>{throw Error('DSH shutdown timed out')})]);assert.deepEqual(stopped,{code:0,signal:null})
 await writeFile(join(attempt,'summary.json'),JSON.stringify({...result,normalShutdown:true},null,2)+'\n');console.log(JSON.stringify({area,attempt,...result,normalShutdown:true}))
}finally{if(exitCode===undefined){child.stdin.end();const fallback=setTimeout(()=>child.kill(),5000);await exit;clearTimeout(fallback)}await writeFile(join(attempt,'process.log'),stdout+'\n'+stderr)}
