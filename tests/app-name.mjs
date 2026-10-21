import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
export default async function({frame,page,workspaceRoot}){
 const app=frame??page;
 const name='Quest3でSTLファイルを立体で見るアプリ';
 await app.locator('.brand').waitFor();
 assert.equal((await app.locator('.brand').textContent()).trim(),name);
 assert.equal(await app.evaluate(()=>document.title),name);
 assert.equal(await app.locator('.stl-app').getByText('STL ROOM',{exact:true}).count(),0);
 await app.getByRole('button',{name:'Questで開く',exact:true}).click();
 await app.locator('.share-dialog').waitFor({state:'visible'});
 assert.ok((await app.locator('.web-launch').getAttribute('href')).startsWith('https://www.oculus.com/open_url/'));
 await app.getByRole('button',{name:'閉じる',exact:true}).click();
 await mkdir(`${workspaceRoot}/artifacts`,{recursive:true});
 await app.locator('.stl-app').screenshot({path:`${workspaceRoot}/artifacts/name-desktop.png`});
 const viewport=page.viewportSize();
 for(const width of [390,320]){
  await page.setViewportSize({width,height:844});
  assert.ok(await app.locator('.brand').evaluate(e=>e.scrollWidth<=e.clientWidth));
  assert.ok(await app.locator('.stl-app').evaluate(e=>e.scrollWidth<=e.clientWidth));
  assert.ok(await app.getByRole('button',{name:'Questで開く',exact:true}).isVisible());
 }
 await app.locator('.stl-app').screenshot({path:`${workspaceRoot}/artifacts/name-mobile.png`});
 if(viewport)await page.setViewportSize(viewport);
 return{passed:true,name,checks:['header','page title','old visible name removed','Quest share action preserved','390px and 320px layout']};
}
