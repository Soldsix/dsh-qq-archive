import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {requiredProfilePeers} from '../scripts/profile-peers.mjs'
async function fixture(packages){
 const base=resolve('.test-artifacts');await mkdir(base,{recursive:true});const profile=await mkdtemp(join(base,'peer-fixture-'))
 await writeFile(join(profile,'package.json'),JSON.stringify({dependencies:{'@deepseek-ai/cordis':'~4.1.0'}}))
 for(const [name,value] of Object.entries(packages)){const path=join(profile,'node_modules','@deepseek-ai',name);await mkdir(path,{recursive:true});await writeFile(join(path,'package.json'),JSON.stringify(value))}
 return profile
}
test('QA peer completion uses declared required peers and excludes optional or existing providers',async()=>{
 const profile=await fixture({one:{peerDependencies:{'@deepseek-ai/cordis':'~4.1.0','@deepseek-ai/dsh-scope':'0.2.2-rc.1','@deepseek-ai/dsh-optional':'0.2.2-rc.1'},peerDependenciesMeta:{'@deepseek-ai/dsh-optional':{optional:true}}},two:{peerDependencies:{'@deepseek-ai/dsh-scope':'0.2.2-rc.1'}}})
 assert.deepEqual(await requiredProfilePeers(profile),['@deepseek-ai/dsh-scope@0.2.2-rc.1'])
})
test('QA peer completion rejects conflicting declared versions without choosing silently',async()=>{
 const profile=await fixture({one:{peerDependencies:{'@deepseek-ai/dsh-scope':'0.2.2-rc.1'}},two:{peerDependencies:{'@deepseek-ai/dsh-scope':'0.1.0'}}})
 await assert.rejects(requiredProfilePeers(profile),/Conflicting QA peer versions/)
})
