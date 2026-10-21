import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';

export default async function({context,workspaceRoot}){
 const page=await context.newPage(),errors=[],owned=new Set(),name=`delete-smoke-${Date.now()}.stl`;
 page.on('pageerror',e=>errors.push(e.message));
 const points=[[0,0,0],[100,0,0],[0,100,0],[0,0,100]],faces=[[0,2,1],[0,1,3],[1,2,3],[2,0,3]];
 const data=Buffer.from(`solid fixture\n${faces.map(f=>`facet normal 0 0 0\nouter loop\n${f.map(i=>`vertex ${points[i].join(' ')}`).join('\n')}\nendloop\nendfacet`).join('\n')}\nendsolid fixture`);
 const api=()=>page.evaluate(async()=>(await(await fetch('/api/models')).json()).models);
 try{
  await page.setViewportSize({width:1440,height:960});await page.goto('https://localhost:8081/',{waitUntil:'networkidle'});
  const before=(await api()).map(record=>record.id);
  for(let i=0;i<2;i++){
   const response=page.waitForResponse(r=>r.url().endsWith('/api/models')&&r.request().method()==='POST');
   await page.locator('.file-input').setInputFiles({name,mimeType:'model/stl',buffer:data});
   const saved=await(await response).json();owned.add(saved.model.id);await writeFile(`${workspaceRoot}/artifacts/library-delete-owned.json`,JSON.stringify([...owned]));
   await page.locator(`.model-card[data-id="${saved.model.id}"] .model-card-open[aria-pressed=true]`).waitFor();
   await page.waitForTimeout(100);
  }
  const fixtures=(await api()).filter(record=>owned.has(record.id));assert.equal(fixtures.length,2);
  // Scope this browser to its fixtures so deleting the last visible card is
  // testable without touching any pre-existing uploaded model.
  await page.route('**/api/models',async route=>{
   if(route.request().method()!=='GET')return route.continue();
   const response=await context.request.get(route.request().url(),{ignoreHTTPSErrors:true}),data=await response.json();data.models=data.models.filter(record=>owned.has(record.id));await route.fulfill({response,json:data});
  });
  await page.reload({waitUntil:'networkidle'});await page.locator('.model-card.selected').waitFor();
  const selected=await page.locator('.model-card.selected').getAttribute('data-id'),a=fixtures.find(f=>f.id!==selected),b=fixtures.find(f=>f.id===selected);
  const card=id=>page.locator(`.model-card[data-id="${id}"]`);
  await page.screenshot({path:`${workspaceRoot}/artifacts/library-delete-desktop.png`,fullPage:true});
  await card(a.id).locator('.model-delete').click();await page.locator('.delete-cancel').click();assert.equal(await page.locator('.model-card').count(),2);
  const fail=async route=>route.fulfill({status:503,json:{error:'削除テスト: 通信に失敗しました。'}});
  await page.route('**/api/models?*',fail);await card(a.id).locator('.model-delete').click();await page.locator('.delete-confirm').click();await page.locator('.toast').filter({hasText:'削除テスト'}).waitFor();assert.equal(await card(a.id).count(),1);await page.unroute('**/api/models?*',fail);
  await card(a.id).locator('.model-delete').click();assert.equal(await page.locator('.delete-model-name').textContent(),name);await page.locator('.delete-confirm').click();await card(a.id).waitFor({state:'detached'});
  assert.equal(await page.locator('.model-card.selected').getAttribute('data-id'),b.id);
  const missing=await page.evaluate(async record=>(await fetch(record.originalModelUrl,{cache:'no-store'})).status,a);assert.equal(missing,404);
  await page.reload({waitUntil:'networkidle'});assert.equal(await card(a.id).count(),0);await card(b.id).waitFor();
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:`${workspaceRoot}/artifacts/library-delete-mobile.png`,fullPage:true});
  assert.ok(await card(b.id).locator('.model-delete').isVisible());
  await card(b.id).locator('.model-delete').click();await page.locator('.delete-confirm').click();await page.locator('.library-empty').waitFor();assert.equal(await page.locator('.stl-app.has-model').count(),0);assert.equal(await page.locator('.model-title').textContent(),'');
  await page.unroute('**/api/models');const after=await api();assert.deepEqual(after.map(record=>record.id).sort(),before.sort());
  assert.deepEqual(errors,[]);
  const result={passed:true,checks:['two same-name uploads have separate delete buttons','cancel keeps the object','failed deletion keeps the card and can retry','only selected ID is deleted','original asset is removed','deletion survives reload','last visible deletion clears preview','mobile delete works','existing uploads untouched'],errors};
  await writeFile(`${workspaceRoot}/artifacts/library-delete-results.json`,JSON.stringify(result,null,2));return result;
 }finally{
  await page.unrouteAll({behavior:'ignoreErrors'});
  for(const id of owned)await page.evaluate(async id=>{await fetch(`/api/models?id=${id}`,{method:'DELETE'});},id).catch(()=>{});
  await page.close();
 }
}
