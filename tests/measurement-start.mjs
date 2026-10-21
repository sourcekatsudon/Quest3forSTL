import assert from 'node:assert/strict';
export default async function({page,frame}){
 const app=frame??page;
 await app.evaluate(async()=>{const {world}=await import('/src/index.ts');await world.renderer.xr.getSession()?.end();});
 const v=[[0,0,0],[100,0,0],[100,100,0],[0,100,0],[0,0,100],[100,0,100],[100,100,100],[0,100,100]];
 const faces=[[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]];
 const source=`solid cube\n${faces.map(f=>`facet normal 0 0 0\nouter loop\n${f.map(i=>`vertex ${v[i].join(' ')}`).join('\n')}\nendloop\nendfacet`).join('\n')}\nendsolid cube`;
 const name=`measurement-cube-${Date.now()}.stl`;
 await app.locator('.file-input').setInputFiles({name,mimeType:'model/stl',buffer:Buffer.from(source)});
 await app.locator('.save-status').filter({hasText:'保存しました'}).waitFor();
 assert.match(await app.locator('.dimension-labels').textContent(),/幅 100\.0 mm/);
 await app.evaluate(async name=>{
  const {world}=await import('/src/index.ts'),{RoomSystem}=await import('/src/room.ts');
  const room=world.getSystem(RoomSystem);room.chosen=room.library.find(m=>m.name===name);
 },name);
 await app.locator('.xr-entry').click();return {passed:true,name};
}
