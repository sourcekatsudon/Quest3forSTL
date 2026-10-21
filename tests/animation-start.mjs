import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
export default async function({page,frame,workspaceRoot}){
 const app=frame??page,name=`animation-smoke-${Date.now()}.glb`;
 await app.evaluate(async()=>{const {world}=await import('/src/index.ts');await world.renderer.xr.getSession()?.end();});
 const data=await readFile(`${workspaceRoot}/tests/fixtures/animated.glb`);
 await app.locator('.file-input').setInputFiles({name,mimeType:'model/gltf-binary',buffer:data});
 await app.locator('.model-title').filter({hasText:name.replace('.glb','')}).waitFor({timeout:30000});
 await app.locator('.save-status').filter({hasText:'保存しました'}).waitFor();
 const frames=[];
 await app.locator('.canvas-host canvas').hover();await page.mouse.down();
 for(let i=0;i<2;i++){
  frames.push(await app.locator('.canvas-host canvas').evaluate(canvas=>canvas.toDataURL()));
  await page.waitForTimeout(220);
 }
 await page.mouse.up();
 assert.notEqual(frames[0],frames[1],'PC preview animates immediately');
 // Exercise real loader + independent skinned instances, not a mock model.
 const checks=await app.evaluate(async()=>{
  const {loadGLB,cloneModelScene,disposeParsed,disposeModelScene}=await import('/src/model.ts');
  const {ModelPlayback}=await import('/src/playback.ts');
  const record=(await(await fetch('/api/models')).json()).models.find(m=>m.name.startsWith('animation-smoke-'));
  const parsed=await loadGLB(await(await fetch(record.modelUrl)).arrayBuffer());
  const a=cloneModelScene(parsed.scene),b=cloneModelScene(parsed.scene),pa=new ModelPlayback(a),pb=new ModelPlayback(b);
  const mesh=a.getObjectByName('AnimatedPlate'),other=b.getObjectByName('AnimatedPlate');
  const bone=a.getObjectByName('AnimatedJoint'),otherBone=b.getObjectByName('AnimatedJoint');
  for(let i=0;i<10;i++)pa.update(.05);
  const before={bone:bone.position.y,morph:mesh.morphTargetInfluences[0],scale:mesh.scale.x};
  pa.setPlaying(false);pa.update(.05);const stopped=bone.position.y===before.bone;
  pa.setPlaying(true);pa.update(.05);const resumed=bone.position.y>before.bone;
  const result={count:pa.count,before,stopped,resumed,independent:otherBone.position.y===0&&other.morphTargetInfluences[0]===0&&mesh.skeleton.bones[0]===bone&&mesh.skeleton.bones[0]!==other.skeleton.bones[0],centered:Math.abs(parsed.geometry.boundingBox.min.x+parsed.geometry.boundingBox.max.x)<1e-5};
  pa.dispose();pb.dispose();disposeModelScene(a);disposeModelScene(b);disposeParsed(parsed);return result;
 });
 assert.equal(checks.count,2);assert.ok(checks.before.bone>.02&&checks.before.morph>.1&&checks.before.scale>1);
 assert.ok(checks.stopped&&checks.resumed&&checks.independent&&checks.centered);
 await writeFile(`${workspaceRoot}/artifacts/animation-loader-results.json`,JSON.stringify(checks,null,2));
 await app.locator('.xr-entry').click();
 return {passed:true,name,checks};
}
