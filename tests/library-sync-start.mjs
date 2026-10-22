import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
export default async function({page,frame,context,workspaceRoot}){
 const app=frame??page,name=`library-sync-${Date.now()}.stl`;
 try{
  await app.evaluate(async()=>{const {world}=await import('/src/index.ts');await world.renderer.xr.getSession()?.end();});
  await app.locator('.xr-entry').click();
  await app.waitForFunction(async()=>{const {world}=await import('/src/index.ts'),{RoomSystem}=await import('/src/room.ts');return world.getSystem(RoomSystem).active;});
  await app.evaluate(async()=>{
   const {world}=await import('/src/index.ts'),{RoomSystem}=await import('/src/room.ts');const room=world.getSystem(RoomSystem);room.page=1;room.renderLibrary();
   Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});
  });
  await app.evaluate(async()=>{const {DesktopApp}=await import('/src/desktop.ts');const root=document.createElement('div');root.id='test-pc-uploader';document.body.append(root);window.testDesktop=new DesktopApp(root);});
  const pc=app.locator('#test-pc-uploader');await pc.locator('.storage-text').filter({hasText:'開発サーバーに保存'}).waitFor();
  const source='solid sync\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 10 0 0\nvertex 0 20 30\nendloop\nendfacet\nendsolid sync';
  await pc.locator('.file-input').setInputFiles({name,mimeType:'model/stl',buffer:Buffer.from(source)});
  await pc.locator('.save-status').filter({hasText:'保存しました'}).waitFor();
  const id=await app.evaluate(async name=>(await(await fetch('/api/models')).json()).models.find(m=>m.name===name).id,name);
  await app.evaluate(async id=>{
   const {world}=await import('/src/index.ts'),{RoomSystem}=await import('/src/room.ts');const room=world.getSystem(RoomSystem),deadline=Date.now()+30000;
   while(!room.library.some(m=>m.id===id)){if(Date.now()>deadline)throw new Error('XR library did not receive the saved PC upload');await new Promise(resolve=>setTimeout(resolve,250));}
  },id);
  const state=await app.evaluate(async id=>{
   const {world}=await import('/src/index.ts'),{RoomSystem}=await import('/src/room.ts'),{RoomLibraryState}=await import('/src/components.ts');const room=world.getSystem(RoomSystem),library=world.requireSceneEntity('RoomLibrary');
   const result={hidden:document.hidden,immersive:world.renderer.xr.isPresenting,page:room.page,newModelAtFront:room.library[0]?.id===id,count:library.getValue(RoomLibraryState,'count'),status:library.getValue(RoomLibraryState,'status'),renderedName:room.renderedText.get('Name0')};
   window.__librarySyncId=id;delete document.hidden;
   return result;
  },id);
  await writeFile(`${workspaceRoot}/artifacts/library-sync-model.json`,JSON.stringify({id,name,...state},null,2));
  assert.ok(state.hidden&&state.immersive&&state.newModelAtFront);assert.equal(state.page,0);assert.equal(state.renderedName,name);assert.equal(state.status,'ready');
  return {passed:true,id,name,...state};
 }finally{await app.evaluate(()=>{delete document.hidden;window.testDesktop?.dispose();document.getElementById('test-pc-uploader')?.remove();});}
}
