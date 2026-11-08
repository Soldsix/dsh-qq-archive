import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
const manifest=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'))
function verify(value){
 assert.equal(value.type,'module');assert.equal(value.bin,undefined);assert.equal(value.dsh.bundle.patch,'./cordis.patch.yml')
 assert.equal(value.dependencies['dsh-im-kit'],'https://github.com/Soldsix/dsh-im-kit/releases/download/v0.2.1/dsh-im-kit-0.2.1.tgz')
 for(const version of Object.values({...value.dependencies,...value.peerDependencies}))assert.equal(/^(file:|link:|workspace:|[A-Za-z]:)/.test(version),false)
}
test('public package installs its library without private paths or application binaries',()=>{
 verify(manifest)
 assert.throws(()=>verify({...manifest,bin:{archive:'dist/index.js'}}))
 assert.throws(()=>verify({...manifest,dependencies:{...manifest.dependencies,'dsh-im-kit':'file:../private'}}))
})
test('public archive read types and runtime exports are available',async()=>{
 const entry=await import('../dist/index.js');assert.equal(typeof entry.ArchiveReadError,'function')
 const types=await readFile(new URL('../dist/index.d.ts',import.meta.url),'utf8');assert.match(types,/read-types/)
})
