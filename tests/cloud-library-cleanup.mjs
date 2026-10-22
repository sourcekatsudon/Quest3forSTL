import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
export default async function({context,workspaceRoot}){
 const fixture=JSON.parse(await readFile(`${workspaceRoot}/artifacts/cloud-sync-fixture.json`,'utf8'));
 assert.match(fixture.id,/^[0-9a-f-]{36}$/);assert.match(fixture.name,/^cloud-sync-\d+\.stl$/);assert.ok(!fixture.before.includes(fixture.id));
 const page=await context.newPage();
 try{
  await page.goto('https://qstl.vercel.app/',{waitUntil:'domcontentloaded'});
  await page.locator('.storage-text').filter({hasText:'クラウドと同期'}).waitFor({timeout:30000});
  const card=page.locator(`.model-card[data-id="${fixture.id}"]`);
  if(await card.count()){
   assert.equal(await card.locator('.card-name').textContent(),fixture.name);
   await card.locator('.model-delete').click();assert.equal(await page.locator('.delete-model-name').textContent(),fixture.name);
   const removed=page.waitForResponse(r=>r.url().includes(`/api/models?id=${fixture.id}`)&&r.request().method()==='DELETE');
   await page.locator('.delete-confirm').click();assert.equal((await removed).status(),204);await card.waitFor({state:'detached'});
  }
  const result=await page.evaluate(async id=>{
   const response=await fetch('/api/models',{cache:'no-store'}),library=await response.json();
   return {status:response.status,ids:library.models.map(m=>m.id),deletedAssetStatus:(await fetch(`/api/assets?id=${id}&kind=model`,{cache:'no-store'})).status};
  },fixture.id);
  assert.equal(result.status,200);assert.ok(!result.ids.includes(fixture.id));assert.ok(fixture.before.every(id=>result.ids.includes(id)));assert.equal(result.deletedAssetStatus,410);
  const evidence={passed:true,deletedTestId:fixture.id,existingModelsPreserved:true,modelCount:result.ids.length};
  await writeFile(`${workspaceRoot}/artifacts/cloud-library-cleanup-results.json`,JSON.stringify(evidence,null,2));return evidence;
 }finally{await page.close();}
}
