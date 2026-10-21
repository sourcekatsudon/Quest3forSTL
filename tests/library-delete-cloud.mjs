import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';

export default async function({context,workspaceRoot}){
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const name=`delete-cloud-smoke-${Date.now()}.stl`,source=Buffer.from('solid fixture\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 100 0 0\nvertex 0 100 0\nendloop\nendfacet\nendsolid fixture');
 let record;
 try{
  await page.goto('https://stl-room-photors-projects.vercel.app/',{waitUntil:'networkidle'});
  const before=await page.evaluate(async()=>(await(await fetch('/api/models')).json()).models.map(m=>m.id));
  const saved=page.waitForResponse(response=>response.url().endsWith('/api/models')&&response.request().method()==='POST');
  await page.locator('.file-input').setInputFiles({name,mimeType:'model/stl',buffer:source});
  const response=await saved;assert.equal(response.status(),201);record=(await response.json()).model;
  await writeFile(`${workspaceRoot}/artifacts/library-delete-cloud-owned.json`,JSON.stringify({id:record.id,name}));
  const card=page.locator(`.model-card[data-id="${record.id}"]`);await card.waitFor();
  await card.locator('.model-delete').click();assert.equal(await page.locator('.delete-model-name').textContent(),name);
  const removed=page.waitForResponse(r=>r.url().includes(`/api/models?id=${record.id}`)&&r.request().method()==='DELETE');
  await page.locator('.delete-confirm').click();const deletion=await removed;if(deletion.status()!==204)throw new Error(await deletion.text());await card.waitFor({state:'detached'});
  await page.reload({waitUntil:'networkidle'});assert.equal(await card.count(),0);
  const after=await page.evaluate(async record=>{
   const library=await(await fetch('/api/models',{cache:'no-store'})).json();
   const asset=await fetch(record.originalModelUrl,{cache:'no-store'}),retry=await fetch(`/api/models?id=${record.id}`,{method:'DELETE'});
   return{ids:library.models.map(m=>m.id),asset:asset.status,retry:retry.status};
  },record);
  assert.ok(before.every(id=>after.ids.includes(id)),'existing user models remain');assert.ok(!after.ids.includes(record.id));assert.equal(after.asset,410);assert.equal(after.retry,204);assert.deepEqual(errors,[]);
  const result={passed:true,id:record.id,cloudUiDelete:true,reloadPersisted:true,oldAssetGone:true,idempotent:true,existingModelsPreserved:true,errors};
  await writeFile(`${workspaceRoot}/artifacts/library-delete-cloud-results.json`,JSON.stringify(result,null,2));return result;
 }finally{
  if(record)await page.evaluate(async id=>{await fetch(`/api/models?id=${id}`,{method:'DELETE'});},record.id).catch(()=>{});
  await page.close();
 }
}
