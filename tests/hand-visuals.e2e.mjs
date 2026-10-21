import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
export default async function({page,frame,workspaceRoot}) {
 const result=await (frame??page).evaluate(async()=>{
  const {world}=await import('/src/index.ts');
  const manager=world.renderer.xr, space=manager.getReferenceSpace();
  return new Promise(resolve=>manager.getSession().requestAnimationFrame((time,xrFrame)=>resolve(
  ['left','right'].map(side=>{
   const source=world.input.xr.getPrimaryInputSource(side);
   const model=world.input.xr.visualAdapters.hand[side].visual?.model;
   const errors=['wrist','index-finger-tip','thumb-tip'].map(name=>{
    const pose=xrFrame.getJointPose(source.hand.get(name),space);
    const expected=world.camera.position.clone().set(pose.transform.position.x,pose.transform.position.y,pose.transform.position.z);
    world.player.localToWorld(expected);
    const actual=model.getObjectByName(name).getWorldPosition(world.camera.position.clone());
    return actual.distanceTo(expected);
   });
   const surfaces=[];model.traverse(n=>{if(n.isSkinnedMesh)surfaces.push({opacity:n.material.opacity,depthTest:n.material.depthTest});});
   return {side,visible:model.visible,forearm:!!model.getObjectByName('Estimated forearm ghost'),errors,surfaces};
  }))));
 });
 for(const hand of result){
  assert.ok(hand.visible&&hand.forearm);
  assert.ok(hand.errors.every(e=>e<.001),'visible joints align with live tracked joints to within 1 mm');
  assert.ok(hand.surfaces.length>0&&hand.surfaces.every(m=>m.opacity>0&&m.opacity<.5&&m.depthTest===false));
 }
 await writeFile(`${workspaceRoot}/artifacts/hand-visual-alignment.json`,JSON.stringify(result,null,2));
 return {passed:true,hands:result};
}
