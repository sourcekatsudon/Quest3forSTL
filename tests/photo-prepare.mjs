import {writeFile} from 'node:fs/promises';
export default async function({frame,page,workspaceRoot}){
 const app=frame??page;
 if(!await app.evaluate(async()=>!!(await import('/src/index.ts')).world.renderer.xr.getSession()))await app.locator('.xr-entry').click();
 await app.evaluate(()=>{window.IWER_DEVICE.primaryInputMode='hand';});
 await page.waitForTimeout(150);
 const poses=await app.evaluate(async()=>{
  const {world}=await import('/src/index.ts');const Vector3=world.camera.position.constructor,Matrix4=world.camera.matrix.constructor,Quaternion=world.camera.quaternion.constructor;
  const {RoomSystem}=await import('/src/room.ts');const room=world.getSystem(RoomSystem);
  if(!room.queries.models.entities.size)await room.addChosen();
  // The public IWER preset is input data, not a mutation of application state.
  for(const hand of Object.values(window.IWER_DEVICE.hands)){hand.poseId='point';hand.quaternion.set(0,0,0,1);hand.updatePinchValue(0);}
  return new Promise(resolve=>world.renderer.xr.getSession().requestAnimationFrame((t,frame)=>{
   const result={};
   for(const [side,sign] of [['left',1],['right',-1]]){
    const source=world.input.xr.getPrimaryInputSource(side),device=window.IWER_DEVICE.hands[side];
    const at=name=>{const p=frame.getJointPose(source.hand.get(name),world.renderer.xr.getReferenceSpace()).transform.position;return new Vector3(p.x,p.y,p.z).sub(new Vector3(device.position.x,device.position.y,device.position.z));};
    const base=at('index-finger-phalanx-proximal'),index=at('index-finger-tip').sub(base).normalize(),thumb=at('thumb-tip').sub(at('thumb-phalanx-proximal')).normalize();
    const x=thumb.addScaledVector(index,-thumb.dot(index)).normalize(),z=new Vector3().crossVectors(x,index).normalize();
    const basis=new Matrix4().makeBasis(x,index,z).invert(),target=new Matrix4().makeBasis(new Vector3(sign,0,0),new Vector3(0,sign,0),new Vector3(0,0,1));
    const q=new Quaternion().setFromRotationMatrix(target.multiply(basis));
    const position=new Vector3(-.06*sign,1.6-.06*sign,-.4).sub(base.applyQuaternion(q));
    result[side]={position:{x:position.x,y:position.y,z:position.z},orientation:{x:q.x,y:q.y,z:q.z,w:q.w}};
   }resolve(result);
  }));
 });
 await writeFile(`${workspaceRoot}/artifacts/photo-input-poses.json`,JSON.stringify(poses,null,2));return {prepared:true,poses};
}

