export default async function({page,frame}){
 return(frame??page).evaluate(async()=>{
  const {world}=await import('/src/index.ts'),{RoomSystem}=await import('/src/room.ts'),{RoomMeasurementSystem}=await import('/src/measurements.ts');
  const room=world.getSystem(RoomSystem),tool=world.getSystem(RoomMeasurementSystem),mp=world.input.xr.multiPointers.right;
  const inspect=kind=>{const pointer=mp.getPointer(kind),pick=pointer.getIntersection();return {enabled:pointer.getEnabled(),name:pick?.object.name,void:pick?.object.isVoidObject,point:pick?.point.toArray(),facePoint:pick?.pointOnFace?.toArray(),face:pick?.face,faceIndex:pick?.faceIndex,parents:pick?[pick.object.parent?.name,pick.object.parent?.parent?.name]:[],model:tool.modelFor(pick)?.object3D?.name};};
  return {locked:room.measurementLocked,lines:[...tool.views.values()].map(v=>({text:v.text,a:v.a.position.toArray(),b:v.b.position.toArray(),label:v.label.position.toArray(),visible:v.cord.visible})),right:{ray:inspect('ray'),touch:inspect('touch'),touchButtons:[...mp.getPointer('touch').getButtonsDown()],tip:world.player.indexTipSpaces.right.getWorldPosition(world.camera.position.clone()).toArray()},toolVisible:tool.live.visible,targetVisible:tool.target.visible};
 });
}
