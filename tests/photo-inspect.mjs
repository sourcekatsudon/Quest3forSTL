export default async function({frame,page}){
 return (frame??page).evaluate(async()=>{
  const {world}=await import('/src/index.ts');
  return new Promise(resolve=>world.renderer.xr.getSession().requestAnimationFrame((t,frame)=>{
   const result={globals:Object.keys(window).filter(k=>/iwer|xrdevice/i.test(k)),joints:{}};
   for(const side of ['left','right']){
    const source=world.input.xr.getPrimaryInputSource(side);result.joints[side]={};
    for(const name of ['index-finger-phalanx-proximal','index-finger-tip','thumb-phalanx-proximal','thumb-tip']){
     const p=frame.getJointPose(source.hand.get(name),world.renderer.xr.getReferenceSpace()).transform.position;result.joints[side][name]=[p.x,p.y,p.z];
    }
   }resolve(result);
  }));
 });
}
