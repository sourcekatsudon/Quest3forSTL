import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,rm,readFile,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {optimizeStl,writeBinaryStl} from './optimize-stl.js';
import {sphereStl} from './optimization-fixture.js';
import {inspectStl} from './validation.js';
import {LocalStore} from './local-store.js';

test('30 MB mesh reduces to 100k triangles with bounds, error budget, and immutable original',async()=>{
 const source=sphereStl(500,600),before=createHash('sha256').update(source).digest('hex');
 const start=performance.now();const result=await optimizeStl(source);const elapsed=performance.now()-start;
 assert.equal(result.metadata.status,'simplified');assert.ok(result.metadata.triangles<=100_000);
 assert.ok(result.bytes.byteLength<source.byteLength*.25);
 assert.ok(result.metadata.estimatedErrorMm<=result.metadata.errorLimitMm);
 assert.deepEqual(inspectStl(result.bytes).dimensions,inspectStl(source).dimensions);
 assert.equal(inspectStl(result.bytes).triangles,result.metadata.triangles);
 assert.equal(createHash('sha256').update(source).digest('hex'),before);
 await mkdir('artifacts',{recursive:true});await writeFile('artifacts/optimization-benchmark.json',JSON.stringify({sourceBytes:source.length,sourceTriangles:inspectStl(source).triangles,...result.metadata,elapsedMs:Math.round(elapsed)},null,2));
});

test('small geometry passes through byte-for-byte and disconnected borders are not forcibly removed',async()=>{
 const source=sphereStl(8,16);assert.equal((await optimizeStl(source)).bytes,source);
 const points=new Float32Array([0,0,0,1,0,0,0,1,0,10,0,0,11,0,0,10,1,0]);
 const separate=writeBinaryStl(points,new Uint32Array([0,1,2,3,4,5]));
 const result=await optimizeStl(separate,{targetTriangles:1,maxErrorMm:.0001});
 assert.equal(result.bytes,separate);assert.equal(result.metadata.status,'quality-limited');
});

test('strict geometric error can stop above target without silently exceeding error limit',async()=>{
 const source=sphereStl(24,48);const result=await optimizeStl(source,{targetTriangles:12,maxErrorMm:0});
 assert.equal(result.metadata.status,'quality-limited');assert.ok(result.metadata.triangles>12);
 assert.equal(result.metadata.estimatedErrorMm,0);
});

test('local persistence serves optimized bytes and retains exact original bytes and metadata',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'stl-optimized-'));
 try{
  const source=sphereStl(250,240),store=new LocalStore(directory);
  const uploaded=await store.upload(source,'model','高精細.stl');
  const record=await store.commit({name:'高精細.stl',modelPathname:uploaded.pathname});
  assert.ok(record.optimization!.triangles<record.triangles);
  assert.deepEqual(new Uint8Array(await store.asset(record.id,'original')),source);
  const display=await store.asset(record.id,'model');assert.equal(display.length,record.optimization!.size);
  assert.deepEqual(inspectStl(display).dimensions,record.dimensions);
  const fresh=(await new LocalStore(directory).list())[0];assert.equal(fresh.optimization!.triangles,record.optimization!.triangles);
  assert.ok(!('displayPathname' in fresh));
  assert.equal(new DataView((await readFile(join(directory,uploaded.pathname))).buffer).byteLength>0,true);
 }finally{await rm(directory,{recursive:true,force:true});}
});
