export default async function({page,frame}){
 return(frame??page).evaluate(async()=>{
  const {world}=await import('/src/index.ts'),{RoomSystem}=await import('/src/room.ts'),{RoomMeasurementSystem}=await import('/src/measurements.ts');
  const room=world.getSystem(RoomSystem),tool=world.getSystem(RoomMeasurementSystem),model=room.selected,playback=room.playbacks.get(model),proxy=tool.proxies.get(model);
  let maxPoseError=0;
  for(const mesh of proxy?.meshes??[]){const original=tool.proxyMeshes.get(mesh),position=mesh.geometry.getAttribute('position');for(let i=0;i<position.count;i++){
   const expected=original.getVertexPosition(i,world.camera.position.clone()),actual=world.camera.position.clone().fromBufferAttribute(position,i);maxPoseError=Math.max(maxPoseError,expected.distanceTo(actual));
  }}
  return {time:playback?.mixer.time,playing:playback?.playing,proxyMeshes:proxy?.meshes.length??0,maxPoseError};
 });
}
