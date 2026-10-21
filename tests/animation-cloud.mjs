import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
export default async function({context,workspaceRoot}){
 const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
 const bytes=await readFile(`${workspaceRoot}/tests/fixtures/animated.glb`),name=`browser-cloud-smoke-animation-${Date.now()}.glb`;
 try{
  await page.goto('https://stl-room-photors-projects.vercel.app/',{waitUntil:'networkidle'});
  await page.locator('.file-input').setInputFiles({name,mimeType:'model/gltf-binary',buffer:bytes});
  await page.locator('.model-title').filter({hasText:name.replace('.glb','')}).waitFor({timeout:60000});
  await page.locator('.save-status').filter({hasText:'クラウドに保存しました'}).waitFor({timeout:60000});
  const record=await page.evaluate(async name=>(await(await fetch('/api/models')).json()).models.find(m=>m.name===name),name);
  assert.ok(record);await writeFile(`${workspaceRoot}/artifacts/cloud-browser-model.json`,JSON.stringify(record));
  const original=Buffer.from(await page.evaluate(async record=>Array.from(new Uint8Array(await(await fetch(record.originalModelUrl)).arrayBuffer())),record));
  assert.equal(createHash('sha256').update(original).digest('hex'),createHash('sha256').update(bytes).digest('hex'));
  await page.reload({waitUntil:'networkidle'});await page.locator('.model-title').filter({hasText:name.replace('.glb','')}).waitFor();
  const canvas=page.locator('.canvas-host canvas');await canvas.hover();await page.mouse.down();
  const a=await canvas.evaluate(c=>c.toDataURL());await page.waitForTimeout(300);const b=await canvas.evaluate(c=>c.toDataURL());await page.mouse.up();
  assert.notEqual(a,b,'saved GLB automatically animates after reloading production');assert.deepEqual(errors,[]);
  const result={passed:true,recordId:record.id,originalPreserved:true,autoplaysAfterReload:true,errors};
  await writeFile(`${workspaceRoot}/artifacts/animation-cloud-results.json`,JSON.stringify(result));return result;
 }finally{await page.close();}
}
