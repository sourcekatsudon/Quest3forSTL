import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
export default async function({page,frame,workspaceRoot}){
 const app=frame??page,name=`glb-floor-smoke-${Date.now()}.glb`;
 await app.evaluate(async()=>{const {world}=await import('/src/index.ts');await world.renderer.xr.getSession()?.end();});
 const bytes=await readFile(`${workspaceRoot}/tests/fixtures/materials.glb`);
 await app.locator('.file-input').setInputFiles({name,mimeType:'model/gltf-binary',buffer:bytes});
 await app.locator('.save-status').filter({hasText:'保存しました'}).waitFor();
 await app.locator('.explode-button').waitFor();
 assert.ok(await app.locator('.explode-button').isEnabled(),'PC GLB explosion is available');
 await app.locator('.explode-button').click();
 await app.locator('.explode-range').fill('100');
 assert.match(await app.locator('.explode-controls output').textContent(),/100%/);
 await app.locator('.explode-range').fill('0');
 await app.evaluate(async name=>{
  const {world}=await import('/src/index.ts'),{RoomSystem}=await import('/src/room.ts');
  const room=world.getSystem(RoomSystem);room.chosen=room.library.find(m=>m.name===name);
 },name);
 await app.locator('.xr-entry').click();
 await app.waitForFunction(async()=>{
  const {world}=await import('/src/index.ts'),{RoomSystem}=await import('/src/room.ts');
  return world.getSystem(RoomSystem).queries.models.entities.size===1;
 });
 const state=await app.evaluate(async()=>{
  const {world}=await import('/src/index.ts'),{RoomSystem}=await import('/src/room.ts'),{RoomModel}=await import('/src/components.ts');
  const room=world.getSystem(RoomSystem),a=[...room.queries.models.entities][0];
  a.getVectorView(RoomModel,'homePosition').set([0,1.55,-.6]);room.select(a);room.resetSelected();
  await room.addChosen();const b=[...room.queries.models.entities].find(e=>e!==a);
  b.getVectorView(RoomModel,'homePosition').set([0,.7,-.6]);room.select(b);room.resetSelected();room.select(a);
  return {parts:a.getValue(RoomModel,'partCount'),model:a.index,lower:b.index};
 });
 assert.equal(state.parts,2);return {passed:true,name,...state};
}
