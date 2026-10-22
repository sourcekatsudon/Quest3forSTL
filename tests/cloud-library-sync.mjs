import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';

/** Opt-in production test. Creates one UUID-tagged model; cleanup is a separate step. */
export default async function({page,frame,context,workspaceRoot}){
 const app=frame??page,origin='https://qstl.vercel.app';
 const fixture=process.env.CLOUD_SYNC_REUSE_FIXTURE==='1'?JSON.parse(await readFile(`${workspaceRoot}/artifacts/cloud-sync-fixture.json`,'utf8')):null;
 const name=fixture?.name??`cloud-sync-${Date.now()}.stl`;
 // The managed emulator reads the real production API. Its writes stay disabled.
 await context.route(`${new URL(app.url()).origin}/api/**`,async route=>{
  const request=route.request();if(request.method()!=='GET')throw new Error('Emulator must not write to production');
  const url=new URL(request.url());const response=await route.fetch({url:origin+url.pathname+url.search});await route.fulfill({response});
 });
 const pc=await context.newPage();
 try{
  await app.evaluate(async()=>{const {world}=await import('/src/index.ts');await world.renderer.xr.getSession()?.end();});
  await pc.goto(origin,{waitUntil:'domcontentloaded'});
  await pc.locator('.storage-text').filter({hasText:'クラウドと同期'}).waitFor({timeout:45000});
  const before=await pc.evaluate(async()=>{const r=await fetch('/api/models');if(!r.ok)throw Error('Production library offline');return (await r.json()).models.map(m=>m.id);});
  await app.locator('.xr-entry').click();
  await app.evaluate(async()=>{
   const {world}=await import('/src/index.ts'),{RoomSystem}=await import('/src/room.ts');const room=world.getSystem(RoomSystem);
   const deadline=Date.now()+30000;while(!world.renderer.xr.isPresenting||!room.library.length){if(Date.now()>deadline)throw Error('XR cloud library not ready');await new Promise(r=>setTimeout(r,250));}
   Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});
  });
  const source='solid sync\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 10 0 0\nvertex 0 20 30\nendloop\nendfacet\nendsolid sync';
  if(!fixture){
   await pc.locator('.file-input').setInputFiles({name,mimeType:'model/stl',buffer:Buffer.from(source)});
   await pc.locator('.save-status').filter({hasText:'クラウドに保存しました'}).waitFor({timeout:60000});
  }
  const record=await pc.evaluate(async name=>(await(await fetch('/api/models')).json()).models.find(m=>m.name===name),name);
  assert.ok(record?.id);
  if(!fixture){assert.ok(!before.includes(record.id));await writeFile(`${workspaceRoot}/artifacts/cloud-sync-fixture.json`,JSON.stringify({id:record.id,name,before},null,2));}
  else assert.equal(record.id,fixture.id);
  await app.evaluate(async id=>{
   const {world}=await import('/src/index.ts'),{RoomSystem}=await import('/src/room.ts');const room=world.getSystem(RoomSystem),deadline=Date.now()+35000;
   while(!room.library.some(m=>m.id===id)){if(Date.now()>deadline)throw Error('Cloud upload did not reach immersive library');await new Promise(r=>setTimeout(r,250));}
  },record.id);
  const state=await app.evaluate(async id=>{
   const {world}=await import('/src/index.ts'),{RoomSystem}=await import('/src/room.ts'),{RoomLibraryState}=await import('/src/components.ts');const room=world.getSystem(RoomSystem),library=world.requireSceneEntity('RoomLibrary');
   return {hidden:document.hidden,immersive:world.renderer.xr.isPresenting,page:room.page,newModelAtFront:room.library[0]?.id===id,count:library.getValue(RoomLibraryState,'count'),status:library.getValue(RoomLibraryState,'status'),renderedName:room.renderedText.get('Name0')};
  },record.id);
  assert.ok(state.hidden&&state.immersive&&state.newModelAtFront);assert.equal(state.page,0);assert.equal(state.status,'ready');assert.equal(state.renderedName,name);
  const assets=await pc.evaluate(async record=>{
   const model=await fetch(record.modelUrl),thumbnail=await fetch(record.thumbnailUrl);return {modelStatus:model.status,bytes:(await model.arrayBuffer()).byteLength,thumbnailStatus:thumbnail.status,thumbnailType:thumbnail.headers.get('content-type')};
  },record);
  assert.equal(assets.modelStatus,200);assert.equal(assets.thumbnailStatus,200);assert.ok(assets.bytes>0);
  await writeFile(`${workspaceRoot}/artifacts/library-sync-model.json`,JSON.stringify({id:record.id,name,...state},null,2));
  const result={passed:true,reusedFixture:!!fixture,id:record.id,name,...state,assets};
  await writeFile(`${workspaceRoot}/artifacts/cloud-library-sync-results.json`,JSON.stringify(result,null,2));return result;
 }finally{await app.evaluate(()=>{delete document.hidden;});await context.unrouteAll({behavior:'wait'});await pc.close();}
}
