export default async function({page,frame}){
 return (frame??page).evaluate(async()=>{
  const {world}=await import('/src/index.ts'),{RoomSystem}=await import('/src/room.ts');
  const room=world.getSystem(RoomSystem),entity=room.selected,object=entity.object3D,playback=room.playbacks.get(entity);
  return {time:playback?.mixer.time,playing:playback?.playing,bone:object.getObjectByName('AnimatedJoint')?.position.y,morph:object.getObjectByName('AnimatedPlate')?.morphTargetInfluences[0],position:object.position.toArray(),scale:object.scale.toArray(),targetIndex:room.library.findIndex(m=>m.name.startsWith('animation-smoke-')),page:room.page};
 });
}
