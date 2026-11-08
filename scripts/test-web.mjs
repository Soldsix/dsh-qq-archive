/** Headless isolated DSH Web profile; no desktop or real QQ interaction. */
import assert from 'node:assert/strict'
import {pnpmScript} from './pnpm.mjs'
import {spawn} from 'node:child_process'
import {once} from 'node:events'
import {mkdtemp,mkdir,readFile,writeFile,realpath} from 'node:fs/promises'
import {join,delimiter,relative,isAbsolute} from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
const root=fileURLToPath(new URL('../',import.meta.url)),runs=join(root,'..','.test-artifacts','archive-web');await mkdir(runs,{recursive:true})
const resume=process.argv.indexOf('--resume'),area=resume<0?await mkdtemp(join(runs,'web-')):await realpath(process.argv[resume+1])
const owned=relative(runs,area);assert.ok(!owned.startsWith('..')&&!isAbsolute(owned)&&owned.startsWith('web-'),'Resume area must be an isolated Web test directory')
const attempt=await mkdtemp(join(area,'attempt-')),home=join(area,'home'),profile='archive-web',profileRoot=join(home,'profiles',profile)
const argument=name=>{const index=process.argv.indexOf(name);assert.ok(index>=0&&process.argv[index+1],'Required '+name);return process.argv[index+1]}
const dsh=await realpath(join(root,'node_modules','@deepseek-ai','dsh','lib','bin.js'))
const manifest=JSON.parse(await readFile(join(root,'package.json'),'utf8'))
const archive=process.argv.includes('--archive')?await realpath(argument('--archive')):join(root,'artifacts',manifest.name+'-'+manifest.version+'.tgz')
const browserCache=await realpath(process.argv.includes('--browser-cache')?argument('--browser-cache'):join(root,'.test-artifacts','browsers'))
process.env.PLAYWRIGHT_BROWSERS_PATH=browserCache
const {chromium}=await import(pathToFileURL(await realpath(join(root,'node_modules','playwright','index.mjs'))).href)
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/KEY|SECRET|TOKEN|PASSWORD|DEEPSEEK_BASE_URL/i.test(key)&&key.toUpperCase()!=='PATH'))
await mkdir(join(area,'temp'),{recursive:true});Object.assign(env,{PATH:join(root,'node_modules','.bin')+delimiter+(process.env.PATH??process.env.Path??''),DSH_HOME:home,TEMP:join(area,'temp'),TMP:join(area,'temp'),DSH_PRIMARY_RUNTIME:'',DSH_SYSTEM_PROMPT:'Synthetic isolated Web profile.',DEEPSEEK_API_KEY:'synthetic-loopback-only',DEEPSEEK_BASE_URL:'http://127.0.0.1:9/anthropic',PLAYWRIGHT_BROWSERS_PATH:browserCache})
async function run(argv,cwd){
 const timeout=AbortSignal.timeout(180000),child=spawn(process.execPath,argv,{cwd,env,windowsHide:true,signal:timeout,stdio:['ignore','pipe','pipe']});let output='',failure
 child.stdout.on('data',data=>{output+=data});child.stderr.on('data',data=>{output+=data});child.once('error',error=>{failure=error})
 const [code,signal]=await new Promise(done=>child.once('close',(...values)=>done(values)))
 if(failure)throw failure;assert.equal(signal,null);assert.equal(code,0,output.slice(-1800));return output
}
if(resume<0){
await run([dsh,'--profile',profile,'--from-default-profile','web','--dump-config'],area)
const manifest=JSON.parse(await readFile(join(profileRoot,'package.json'),'utf8')),own=JSON.parse(await readFile(join(root,'package.json'),'utf8'))
manifest.pnpm={...manifest.pnpm,overrides:own.overrides};await writeFile(join(profileRoot,'package.json'),JSON.stringify(manifest,null,2)+'\n')
await writeFile(join(profileRoot,'.npmrc'),'package-import-method=copy\nstore-dir='+join(runs,'pnpm-store').replaceAll('\\','/')+'\n')
const pnpm=await pnpmScript(root)
const peers=['@deepseek-ai/cordis@~4.1.0','@deepseek-ai/cordis-plugin-loader@~1.1.0','@deepseek-ai/schemastery@~3.19.0',...['app-boot','brand','config-editor','typert-protocol','client-connection','sandbox','llm-deepseek','llm-deepseek-api-key'].map(name=>'@deepseek-ai/dsh-'+name+'@0.2.2-rc.1')]
await run([pnpm,'add','@deepseek-ai/dsh@0.2.2-rc.1',...peers,'--ignore-scripts'],profileRoot)
await run([dsh,'plugin','--profile',profile,'add',archive],area)
}
await writeFile(join(profileRoot,'cordis.patch.yml'),JSON.stringify([{id:'qq-archive-settings',config:{statusRefreshMs:250}},{id:'session-title-llm',disabled:true},{id:'session-telemetry-otel',disabled:true}],null,2)+'\n')
const child=spawn(process.execPath,[join(profileRoot,'node_modules','@deepseek-ai','dsh','lib','bin.js'),'--profile',profile,'--host','127.0.0.1','--port','0','--no-open'],{cwd:area,env,windowsHide:true,stdio:['pipe','pipe','pipe']})
let stdout='',stderr='',exitCode,context,page;const errors=[],checks=[],exit=once(child,'close').then(([code,signal])=>{exitCode=code;return{code,signal}})
const ready=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Web profile did not report ready')),60000),inspect=()=>{const match=(stdout+'\n'+stderr).match(/http:\/\/127\.0\.0\.1:\d+[^\s\u001b]*/);if(match){clearTimeout(timer);resolve(match[0])}};child.stdout.on('data',data=>{stdout+=data;inspect()});child.stderr.on('data',data=>{stderr+=data;inspect()});void exit.then(()=>{clearTimeout(timer);reject(Error('Web profile exited before ready'))})})
try{
 const login=await ready,origin=new URL(login).origin
 context=await chromium.launchPersistentContext(join(attempt,'browser-profile'),{headless:true,viewport:{width:1280,height:1000},locale:'zh-CN',colorScheme:'light',env})
 await context.route('**/*',route=>{const url=new URL(route.request().url());return url.origin===origin||['data:','blob:'].includes(url.protocol)?route.continue():route.abort()})
 page=context.pages()[0]??await context.newPage();page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message))
 await page.goto(login,{waitUntil:'domcontentloaded'});const proceed=page.getByRole('button',{name:/^继续$|^Continue$/});await proceed.waitFor({state:'visible',timeout:5000}).catch(()=>{});if(await proceed.isVisible())await proceed.click()
 const dismiss=page.getByRole('dialog').getByRole('button',{name:/^关闭$|^Close$/});if(await dismiss.isVisible())await dismiss.click()
 await page.getByRole('button',{name:/^插件$|^Plugins$/}).first().click();if(await proceed.isVisible())await proceed.click();await page.getByText('dsh-qq-archive',{exact:true}).first().click()
 const form=page.locator('.qqarchive-page');await form.getByText(/归档未运行|Archive inactive/).waitFor();checks.push('page-visible-while-disabled')
 await form.getByLabel(/租户 ID|Tenant IDs/).fill('tenant-test');await form.getByLabel(/账号 ID|Account IDs/).fill('account-test');await form.getByLabel(/群 ID|Group IDs/).fill('group-test')
 await form.getByRole('button',{name:/^保存$|^Save$/}).click();await page.getByText(/^配置已保存$|^Settings saved$/).waitFor();checks.push('scoped-settings-save')
 await form.getByRole('switch',{name:/启用归档|Enable archive/}).click();await form.getByRole('button',{name:/^保存$|^Save$/}).click();await form.getByText(/归档运行中|Archive active/).waitFor()
 assert.equal(await form.getByLabel(/群 ID|Group IDs/).isDisabled(),true);checks.push('active-archive-locks-edits')
 await page.screenshot({path:join(attempt,'light.png'),fullPage:true});await page.emulateMedia({colorScheme:'dark'});await page.screenshot({path:join(attempt,'dark.png'),fullPage:true})
 await page.getByRole('button',{name:/^收起侧边栏$|^Collapse sidebar$/}).click();await page.setViewportSize({width:520,height:1000});await form.evaluate(element=>element.scrollIntoView({block:'start'}));assert.ok(await form.evaluate(element=>element.scrollWidth<=element.clientWidth+2));await page.screenshot({path:join(attempt,'narrow.png'),fullPage:true});checks.push('light-dark-narrow-layout')
 await page.setViewportSize({width:1280,height:1000});await form.getByRole('switch',{name:/启用归档|Enable archive/}).click();await form.getByRole('button',{name:/^保存$|^Save$/}).click()
 await form.getByText(/归档未运行|Archive inactive/).waitFor();const groups=form.getByLabel(/群 ID|Group IDs/);assert.equal(await groups.isDisabled(),false)
 await groups.fill('group-test\ngroup-other');await form.getByRole('button',{name:/^保存$|^Save$/}).click();await page.getByText(/^配置已保存$|^Settings saved$/).waitFor();checks.push('settings-edit-after-archive-is-paused')
 await form.getByRole('switch',{name:/启用归档|Enable archive/}).click();await form.getByRole('button',{name:/^保存$|^Save$/}).click();await form.getByText(/归档运行中|Archive active/).waitFor();checks.push('resume-after-edit')
 assert.deepEqual(errors,[]);await writeFile(join(attempt,'summary.json'),JSON.stringify({passed:true,checks,clientErrors:errors,realQqMessagesSent:0},null,2)+'\n');console.log(JSON.stringify({area,attempt,passed:true,checks,realQqMessagesSent:0}))
}catch(error){console.error(stderr);if(page){await page.screenshot({path:join(attempt,'failure.png'),fullPage:true}).catch(()=>{});await writeFile(join(attempt,'body.txt'),await page.locator('body').innerText()).catch(()=>{})}throw error
}finally{
 await context?.close();if(exitCode===undefined){child.kill('SIGINT');const fallback=setTimeout(()=>child.kill(),5000);await exit;clearTimeout(fallback)}await writeFile(join(attempt,'process.log'),stdout+'\n'+stderr)
}
