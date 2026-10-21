export default async function({page,frame}) {
 return (frame??page).evaluate(async()=>{
  const {world}=await import('/src/index.ts');
  return ['left','right'].map(side=>{
   const adapter=world.input.xr.visualAdapters.hand[side];
   const model=adapter.visual?.model;
   const joints=['wrist','index-finger-tip','thumb-tip'].map(name=>({name,position:model?.getObjectByName(name)?.getWorldPosition(world.camera.position.clone()).toArray()}));
   const primary=world.input.xr.getPrimaryInputSource(side);
   return {side,implementation:adapter.visual?.constructor.name,visible:model?.visible,joints,forearm:!!model?.getObjectByName('Estimated forearm ghost'),gamepad:primary?.gamepad?.buttons.map(b=>({value:b.value,pressed:b.pressed})),pinch:adapter.getPinchStrength(),grip:world.player.gripSpaces[side].position.toArray()};
  });
 });
}
