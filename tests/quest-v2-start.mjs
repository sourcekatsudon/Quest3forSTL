import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
export default async function({page,frame,workspaceRoot}){
 let app=frame??page;const name=`browser-cloud-smoke-quest-v2-${Date.now()}.glb`;
 await app.locator('.file-input').setInputFiles({name,mimeType:'model/gltf-binary',buffer:await readFile(`${workspaceRoot}/tests/fixtures/materials.glb`)});
 await app.locator('.model-title').filter({hasText:name.replace('.glb','')}).waitFor({timeout:30000});
 await app.locator('.save-status').filter({hasText:'保存しました'}).waitFor();
 assert.match(await app.locator('.dimension-labels').textContent(),/幅 1,400\.0 mm/);
 assert.equal(await app.locator('.model-card.selected img').evaluate(img=>img.decode().then(()=>img.naturalWidth>0)),true);
 const record=await app.evaluate(async name=>(await(await fetch('/api/models')).json()).models.find(m=>m.name===name),name);assert.equal(record.format,'glb');assert.equal(record.triangles,24);
 await writeFile(`${workspaceRoot}/artifacts/quest-v2-record.json`,JSON.stringify(record));
 await page.reload({waitUntil:'networkidle'});
 for(let i=0;i<100;i++){const found=[];for(const candidate of page.frames())if(await candidate.locator('.stl-app').count().catch(()=>0))found.push(candidate);if(found.length){app=found[0];break;}await page.waitForTimeout(100);}
 await app.locator('.model-title').filter({hasText:name.replace('.glb','')}).waitFor();
 await app.locator('.xr-entry').click();return{passed:true,name,record};
}
