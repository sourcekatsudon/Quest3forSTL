import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
export default async function({context,workspaceRoot}){
 const fixture=JSON.parse(await readFile(`${workspaceRoot}/artifacts/optimization-fixture.json`,'utf8'));
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto('https://qstl.vercel.app/',{waitUntil:'networkidle'});
  await page.locator('.storage-text').filter({hasText:'クラウドと同期'}).waitFor();
  await page.locator('.file-input').setInputFiles(`${workspaceRoot}/artifacts/${fixture.name}`);
  await page.locator('.save-status').filter({hasText:'表示用に軽量化済み'}).waitFor({timeout:150000});
  const record=await page.evaluate(async name=>(await(await fetch('/api/models',{cache:'no-store'})).json()).models.find(m=>m.name===name),fixture.name);
  assert.ok(record);await writeFile(`${workspaceRoot}/artifacts/cloud-browser-model.json`,JSON.stringify(record));
  assert.equal(record.triangles,fixture.triangles);assert.equal(record.optimization.status,'simplified');
  assert.ok(record.optimization.triangles<=100000);assert.ok(record.optimization.size<fixture.bytes*.25);
  assert.deepEqual(record.dimensions,{width:200,depth:200,height:200});
  await page.locator('.mode-text').filter({hasText:'100,000 三角形'}).waitFor();
  assert.match(await page.locator('.model-card.selected .card-meta').textContent(),/軽量化済み/);
  const assets=await page.evaluate(async record=>{
   const display=await(await fetch(record.modelUrl)).arrayBuffer();const original=await(await fetch(record.originalModelUrl)).arrayBuffer();
   const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',original))).map(b=>b.toString(16).padStart(2,'0')).join('');
   return{displayBytes:display.byteLength,triangles:new DataView(display).getUint32(80,true),originalBytes:original.byteLength,sha256:digest};
  },record);
  assert.equal(assets.displayBytes,record.optimization.size);assert.equal(assets.triangles,record.optimization.triangles);
  assert.equal(assets.originalBytes,fixture.bytes);assert.equal(assets.sha256,fixture.sha256);
  await page.reload({waitUntil:'networkidle'});await page.locator('.mode-text').filter({hasText:'100,000 三角形'}).waitFor();
  assert.deepEqual(errors,[]);
  await page.screenshot({path:`${workspaceRoot}/artifacts/optimization-cloud.png`});
  const result={passed:true,sourceBytes:fixture.bytes,sourceTriangles:fixture.triangles,optimization:record.optimization,assets,checks:['30 MB native browser multipart upload','server decimation','automatic optimized preview swap','original byte preservation','same CAD dimensions','optimized reload'],errors};
  await writeFile(`${workspaceRoot}/artifacts/optimization-cloud-results.json`,JSON.stringify(result,null,2));return result;
 }finally{await page.close();}
}
