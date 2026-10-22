import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
export default async function({context,workspaceRoot}){
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const buffer=await readFile(`${workspaceRoot}/tests/fixtures/materials.glb`),name=`browser-cloud-smoke-glb-${Date.now()}.glb`;
 try{
  await page.goto('https://qstl.vercel.app/',{waitUntil:'networkidle'});
  await page.locator('.storage-text').filter({hasText:'クラウドと同期'}).waitFor();
  await page.locator('.file-input').setInputFiles({name,mimeType:'model/gltf-binary',buffer});
  await page.locator('.save-status').filter({hasText:'クラウドに保存しました'}).waitFor({timeout:60000});
  const record=await page.evaluate(async name=>(await(await fetch('/api/models')).json()).models.find(m=>m.name===name),name);
  assert.ok(record);await writeFile(`${workspaceRoot}/artifacts/cloud-browser-model.json`,JSON.stringify(record));assert.equal(record.format,'glb');assert.equal(record.triangles,24);
  assert.match(await page.locator('.dimension-labels').textContent(),/幅 1,400\.0 mm/);
  assert.equal(await page.locator('.model-card.selected img').evaluate(img=>img.decode().then(()=>img.naturalWidth>0)),true);
  const assets=await page.evaluate(async r=>{const response=await fetch(r.modelUrl),bytes=await response.arrayBuffer();return{mime:response.headers.get('content-type'),bytes:bytes.byteLength,sha256:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(b=>b.toString(16).padStart(2,'0')).join('')};},record);
  assert.equal(assets.sha256,createHash('sha256').update(buffer).digest('hex'));assert.match(assets.mime,/model\/gltf-binary/);
  await page.reload({waitUntil:'networkidle'});await page.locator('.model-title').filter({hasText:name.replace('.glb','')}).waitFor();assert.match(await page.locator('.dimension-labels').textContent(),/幅 1,400\.0 mm/);assert.deepEqual(errors,[]);
  await page.screenshot({path:`${workspaceRoot}/artifacts/glb-cloud.png`});
  const result={passed:true,assets,checks:['native GLB upload','cloud validation and original preservation','textured preview and thumbnail','metres to mm with node transforms','reload'],errors};await writeFile(`${workspaceRoot}/artifacts/glb-cloud-results.json`,JSON.stringify(result,null,2));return result;
 }finally{await page.close();}
}
