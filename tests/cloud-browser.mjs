import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
export default async function({context,workspaceRoot}){
 const page=await context.newPage();
 const origin='https://stl-room-photors-projects.vercel.app';
 const name=`browser-cloud-smoke-${crypto.randomUUID()}.stl`;
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(origin,{waitUntil:'networkidle'});
  await page.locator('.storage-text').filter({hasText:'クラウドと同期'}).waitFor();
  const stl='solid smoke\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 10 0 0\nvertex 0 20 30\nendloop\nendfacet\nendsolid smoke';
  await page.locator('.file-input').setInputFiles({name,mimeType:'model/stl',buffer:Buffer.from(stl)});
  await page.locator('.save-status').filter({hasText:'クラウドに保存しました'}).waitFor({timeout:45000});
  const entry=await page.evaluate(async name=>(await(await fetch('/api/models')).json()).models.find(m=>m.name===name),name);
  assert.ok(entry?.thumbnailUrl);assert.deepEqual(entry.dimensions,{width:10,depth:20,height:30});
  await writeFile(`${workspaceRoot}/artifacts/cloud-browser-model.json`,JSON.stringify(entry));
  await page.reload({waitUntil:'networkidle'});
  await page.locator('.model-title').filter({hasText:name.replace(/\.stl$/,'')}).waitFor({timeout:30000});
  await page.locator('.card-name').filter({hasText:name}).waitFor();
  assert.equal(await page.locator('.app-header .quest-button').count(),0);
  await page.getByRole('button',{name:'ブラウザで表示',exact:true}).click();
  assert.ok(await page.locator('.canvas-host canvas').evaluate(element=>document.activeElement===element));
  assert.ok(await page.getByRole('button',{name:'Questで開く',exact:true}).isVisible());
  assert.equal(await page.locator('.quest-access-guide a').textContent(),'https://stl-room-photors-projects.vercel.app/');
  const thumbnails=await page.locator('.model-list img').evaluateAll(images=>images.every(i=>i.complete&&i.naturalWidth>0));
  assert.ok(thumbnails,'Saved cloud thumbnail loads after reload');
  assert.deepEqual(errors,[]);
  await page.screenshot({path:`${workspaceRoot}/artifacts/cloud-browser.png`});
  const result={passed:true,origin,name,id:entry.id,dimensions:entry.dimensions,checks:['native browser multipart upload','cloud save','shared library','thumbnail','reload persistence','desktop fallback'],errors};
  await writeFile(`${workspaceRoot}/artifacts/cloud-browser-results.json`,JSON.stringify(result,null,2));return result;
 }finally{await page.close();}
}


