import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
export default async function({frame,page,workspaceRoot}){
 const app=frame??page;
 const fixture=JSON.parse(await readFile(`${workspaceRoot}/artifacts/optimization-fixture.json`,'utf8'));
 await app.locator('.file-input').setInputFiles(`${workspaceRoot}/artifacts/${fixture.name}`);
 await app.locator('.save-status').filter({hasText:'表示用に軽量化済み'}).waitFor({timeout:90000});
 await app.locator('.mode-text').filter({hasText:'100,000 三角形'}).waitFor();
 const record=await app.evaluate(async name=>(await(await fetch('/api/models')).json()).models.find(m=>m.name===name),fixture.name);
 assert.equal(record.optimization.triangles,100000);assert.equal(record.triangles,598800);
 assert.match(await app.locator('.dimension-labels').textContent(),/幅 200\.0 mm/);
 // Reload as the Quest would when opening the shared library on another device.
 await page.reload({waitUntil:'networkidle'});
 let reloaded=page;
 if(frame){
  for(let attempt=0;attempt<100;attempt++){
   const candidates=page.frames();
   const matches=await Promise.all(candidates.map(candidate=>candidate.locator('.stl-app').count().catch(()=>0)));
   const index=matches.findIndex(count=>count>0);
   if(index>=0){reloaded=candidates[index];break;}
   await page.waitForTimeout(100);
  }
 }
 await reloaded.locator('.mode-text').filter({hasText:'100,000 三角形'}).waitFor();
 await reloaded.locator('.xr-entry').click();
 await writeFile(`${workspaceRoot}/artifacts/optimization-local-record.json`,JSON.stringify(record));
 return{passed:true,id:record.id,originalTriangles:record.triangles,displayTriangles:record.optimization.triangles};
}
