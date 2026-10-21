import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
export default async function({frame,page,workspaceRoot}){
 let app=frame??page;
 const count=await app.evaluate(async()=>{const {world}=await import('/src/index.ts');await world.renderer.xr.getSession()?.end();return(await(await fetch('/api/photos')).json()).photos.length;});
 await app.locator('.photos-button').click();
 await app.locator('.photo-card').first().waitFor();
 assert.equal(await app.locator('.photo-card').count(),count);
 assert.ok(await app.locator('.photo-description').textContent().then(t=>t.includes('実際の部屋は写りません')));
 const loaded=await app.locator('.photo-card img').evaluateAll(images=>Promise.all(images.map(image=>image.decode().then(()=>image.naturalWidth>0))));assert.ok(loaded.every(Boolean));
 await app.locator('.photo-close').click();
 await app.evaluate(()=>location.reload());await page.waitForTimeout(1500);
 await app.locator('.photos-button').click();await app.locator('.photo-card').first().waitFor();assert.equal(await app.locator('.photo-card').count(),count);
 await app.locator('.photo-refresh').click();await app.locator('.photo-status').filter({hasText:`${count}枚`}).waitFor();
 const download=await app.locator('.photo-card>a[download]').first().getAttribute('download');assert.match(download,/^Quest-.+\.jpg$/);
 await writeFile(`${workspaceRoot}/artifacts/photo-gallery-results.json`,JSON.stringify({passed:true,count,reloadPersisted:true,decodedImages:loaded.length,download},null,2));
 return {passed:true,count,reloadPersisted:true};
}
