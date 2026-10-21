import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';

export default async function run({page,frame,workspaceRoot}){
  return stepFlow({page,app:frame??page,workspaceRoot,cloud:false});
}

export async function stepFlow({page,app,workspaceRoot,cloud}){
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const name=`browser-cloud-smoke-step-${Date.now()}.step`;
  const buffer=await readFile(`${workspaceRoot}/tests/fixtures/cax-if-assembly.stp`);
  await app.locator('.file-input').setInputFiles({name,mimeType:'model/step',buffer});
  await app.locator('.model-title').filter({hasText:name.replace(/\.step$/,'')}).waitFor({timeout:60000});
  const record=await app.evaluate(async name=>(await(await fetch('/api/models')).json()).models.find(m=>m.name===name),name);
  assert.ok(record);await writeFile(`${workspaceRoot}/artifacts/${cloud?'cloud-browser-model':'step-local-model'}.json`,JSON.stringify(record));
  assert.equal(record.format,'step');assert.equal(record.partCount,18);
  const button=app.getByRole('button',{name:'爆発図',exact:true});assert.ok(await button.isEnabled());
  await button.click();assert.equal(await button.getAttribute('aria-expanded'),'true');
  assert.match(await app.locator('.part-count').textContent(),/18 部品/);
  const slider=app.getByRole('slider',{name:'部品の分離量'});await slider.focus();await slider.press('End');
  assert.equal(await slider.inputValue(),'100');assert.equal(await app.locator('.explode-controls output').textContent(),'100%');
  assert.ok(await app.locator('.dimension-labels').evaluate(element=>element.classList.contains('is-exploded')));
  const host=await app.locator('.canvas-host').boundingBox();assert.ok(host.height>100);
  await app.locator('.stl-app').screenshot({path:`${workspaceRoot}/artifacts/step-${cloud?'cloud':'local'}-exploded.png`});
  await slider.press('Home');assert.equal(await slider.inputValue(),'0');
  assert.ok(!await app.locator('.dimension-labels').evaluate(element=>element.classList.contains('is-exploded')));
  await slider.press('ArrowRight');assert.equal(await slider.inputValue(),'1');
  await button.click();assert.equal(await app.locator('.explode-range').inputValue(),'0');assert.equal(await button.getAttribute('aria-expanded'),'false');
  const assets=await app.evaluate(async record=>{
    const display=await(await fetch(record.modelUrl)).arrayBuffer();
    const original=await(await fetch(record.originalModelUrl)).arrayBuffer();
    const assembly=await(await fetch(record.assemblyUrl)).json();
    const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',original))).map(b=>b.toString(16).padStart(2,'0')).join('');
    return{displayTriangles:new DataView(display).getUint32(80,true),originalBytes:original.byteLength,sha256:digest,parts:assembly.parts.length};
  },record);
  const {createHash}=await import('node:crypto');
  assert.equal(assets.sha256,createHash('sha256').update(buffer).digest('hex'));assert.equal(assets.parts,18);
  await page.reload({waitUntil:'networkidle'});app=await findApp(page);
  await app.locator('.model-title').filter({hasText:name.replace(/\.step$/,'')}).waitFor();
  assert.ok(await app.locator('.explode-button').isEnabled());assert.equal(await app.locator('.explode-range').inputValue(),'0');
  if(!cloud){
    await app.locator('.file-input').setInputFiles({name:'single-part.step',mimeType:'model/step',buffer:await readFile(`${workspaceRoot}/tests/fixtures/cube.stp`)});
    await app.locator('.model-title').filter({hasText:'single-part'}).waitFor();assert.ok(await app.locator('.explode-button').isDisabled());
    await app.locator('.file-input').setInputFiles({name:'broken.step',mimeType:'model/step',buffer:Buffer.from('not a STEP file')});
    await app.locator('.toast').filter({hasText:/STEP/}).waitFor();assert.match(await app.locator('.model-title').textContent(),/single-part/);
  }
  assert.deepEqual(errors,[]);
  const result={passed:true,partCount:record.partCount,assets,checks:['native STEP upload','assembly conversion','explosion button','keyboard slider 0–100%','reset to assembly','reload with parts','original SHA matches',...(cloud?[]:['single-part disabled','bad STEP keeps current model'])]};
  await writeFile(`${workspaceRoot}/artifacts/step-${cloud?'cloud':'local'}-results.json`,JSON.stringify(result,null,2));
  return result;
}

async function findApp(page){
  for(let attempt=0;attempt<100;attempt++){
    for(const candidate of page.frames())if(await candidate.locator('.stl-app').count().catch(()=>0))return candidate;
    await page.waitForTimeout(100);
  }
  throw new Error('Application frame not found after reload');
}
