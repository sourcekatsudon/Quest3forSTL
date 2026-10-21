import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {prepareModel,validateStep} from './prepare-model.js';
import {inspectStl,validateName,validatePath} from './validation.js';
import {LocalStore} from './local-store.js';

test('real STEP assembly keeps repeated occurrences, assembly paths and inch-to-mm placement',async()=>{
  const bytes=await readFile('tests/fixtures/cax-if-assembly.stp'),original=Buffer.from(bytes);
  const result=await prepareModel(bytes,'組立.stp');
  assert.equal(result.format,'step');assert.equal(result.assembly!.parts.length,18);
  assert.ok(result.assembly!.parts.some(p=>p.path.includes('L_BRACKET_ASSEMBLY_ASM')));
  assert.equal(result.source.dimensions.width,5080);assert.equal(result.source.dimensions.height,3810);
  const display=inspectStl(result.optimized.bytes);
  assert.deepEqual(display.dimensions,result.source.dimensions);
  let end=0;for(const part of result.assembly!.parts){assert.equal(part.start,end);assert.ok(part.count>0);end+=part.count;}
  assert.equal(end,display.triangles);assert.deepEqual(bytes,original);
  const view=new DataView(result.optimized.bytes.buffer);
  const centres=result.assembly!.parts.map(part=>{
    let x=0;for(let t=part.start;t<part.start+part.count;t++)for(let v=0;v<3;v++)x+=view.getFloat32(96+t*50+v*12,true);
    return Math.round(x/(part.count*3));
  });
  assert.ok(new Set(centres).size>5,'repeated instances must remain at different assembly positions');
});

test('single-part STEP remains usable without pretending to be an assembly',async()=>{
  const result=await prepareModel(await readFile('tests/fixtures/cube.stp'),'cube.STEP');
  assert.equal(result.assembly!.parts.length,1);assert.equal(result.source.triangles,12);
  assert.ok(result.source.dimensions.width>0);
});

test('STEP persistence exposes display/assembly separately and preserves original exactly',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'step-assembly-'));
  try{
    const store=new LocalStore(directory),bytes=await readFile('tests/fixtures/cax-if-assembly.stp');
    const upload=await store.upload(bytes,'model','test.step');
    assert.match(upload.pathname,/\.step$/);
    const saved=await store.commit({name:'test.step',modelPathname:upload.pathname});
    assert.equal(saved.partCount,18);assert.equal(saved.format,'step');assert.ok(saved.assemblyUrl);
    assert.deepEqual(Buffer.from(await store.asset(saved.id,'original')),bytes);
    assert.equal(JSON.parse(new TextDecoder().decode(await store.asset(saved.id,'assembly'))).parts.length,18);
    assert.equal(inspectStl(await store.asset(saved.id,'model')).triangles,saved.optimization!.triangles);
    const record=(await new LocalStore(directory).list())[0];
    assert.equal(record.assemblyUrl,saved.assemblyUrl);assert.ok(!('assemblyPathname' in record));
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('STEP validation rejects malformed content and still bounds names/paths',async()=>{
  assert.equal(validateName('組立.STEP'),'組立.STEP');
  assert.match(validatePath('uploads/11111111-1111-1111-1111-111111111111.stp','model'),/\.stp$/);
  assert.throws(()=>validateName('../assembly.step'));
  assert.throws(()=>validatePath('uploads/../assembly.step','model'));
  assert.throws(()=>validateStep(new TextEncoder().encode('solid fake\nendsolid fake')));
  await assert.rejects(prepareModel(new TextEncoder().encode('ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;'),'bad.step'));
});
