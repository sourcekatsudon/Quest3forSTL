export default async function({page,frame}){
 return(frame??page).evaluate(async()=>{
  const {world}=await import('/src/index.ts'),{RoomSystem}=await import('/src/room.ts'),{RoomModel}=await import('/src/components.ts');
  const room=world.getSystem(RoomSystem),record=room.library.find(m=>m.name.startsWith('animation-smoke-'));
  if(!record)throw new Error('Run animation-start.mjs to prepare the generated animation fixture first.');
  await room.addChosen(undefined,record);const entity=room.selected;
  entity.getVectorView(RoomModel,'homePosition').set([.4,1.3,-.9]);room.resetSelected();
  return {entityIndex:entity.index};
 });
}
