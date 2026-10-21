import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
export default async function({page,frame,workspaceRoot}){
 let app=frame??page;
 const name=`XR-assembly-${Date.now()}.step`;
 await app.locator('.file-input').setInputFiles({name,mimeType:'model/step',buffer:await readFile(`${workspaceRoot}/tests/fixtures/cax-if-assembly.stp`)});
 await app.locator('.model-title').filter({hasText:name.replace('.step','')}).waitFor({timeout:60000});
 await page.reload({waitUntil:'networkidle'});
 for(let n=0;n<100;n++){
  const found=[];for(const candidate of page.frames())if(await candidate.locator('.stl-app').count().catch(()=>0))found.push(candidate);
  if(found.length){app=found[0];break;}await page.waitForTimeout(100);
 }
 await app.locator('.model-title').filter({hasText:name.replace('.step','')}).waitFor();
 await app.locator('.xr-entry').click();
 return{clicked:true,name};
}
