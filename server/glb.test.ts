import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {inspectGlb,glbJson} from './glb.js';
import {LocalStore} from './local-store.js';
test('GLB world transforms, metres, embedded texture and original bytes survive persistence',async()=>{
 const bytes=await readFile('tests/fixtures/materials.glb'),source=await inspectGlb(bytes);
 assert.equal(source.triangles,24);assert.ok(Math.abs(source.dimensions.width-1400)<.001);assert.ok(Math.abs(source.dimensions.height-300)<.001);
 const json=glbJson(bytes);assert.equal(json.images.length,1);assert.equal(json.materials[0].pbrMetallicRoughness.metallicFactor,.6);
 const directory=await mkdtemp(join(tmpdir(),'glb-room-'));
 try{const store=new LocalStore(directory),upload=await store.upload(bytes,'model','色付き.glb');const model=await store.commit({name:'色付き.glb',modelPathname:upload.pathname});assert.equal(model.format,'glb');assert.equal(model.optimization!.status,'unchanged');assert.deepEqual(Buffer.from(await store.asset(model.id,'model')),bytes);assert.deepEqual(Buffer.from(await store.asset(model.id,'original')),bytes);}finally{await rm(directory,{recursive:true,force:true});}
});
test('malformed GLB headers and oversized accessor expansion are rejected',async()=>{
 assert.throws(()=>glbJson(new Uint8Array(32)));
 const bytes=await readFile('tests/fixtures/materials.glb'),broken=Buffer.from(bytes);broken.writeUInt32LE(12,8);assert.throws(()=>glbJson(broken));
 const json=glbJson(bytes);json.accessors[0].count=10_000_000;const text=Buffer.from(JSON.stringify(json).padEnd(Math.ceil(JSON.stringify(json).length/4)*4));const file=Buffer.alloc(20+text.length);file.writeUInt32LE(0x46546c67);file.writeUInt32LE(2,4);file.writeUInt32LE(file.length,8);file.writeUInt32LE(text.length,12);file.writeUInt32LE(0x4e4f534a,16);text.copy(file,20);assert.throws(()=>glbJson(file));
});
