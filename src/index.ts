import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { DesktopApp } from './desktop';
import { RoomSystem } from './room';
import { RoomInputVisualSystem } from './hand-visuals';
import './styles.css';
const root=document.getElementById('app')!;
const desktop=new DesktopApp(root);
const xrContainer=document.createElement('div');
xrContainer.id='scene-container';xrContainer.style.cssText='position:fixed;inset:0;z-index:-1;pointer-events:none';
document.body.append(xrContainer);
export let world:World;
async function initialize(){
 try{
  world=await World.create(xrContainer,projectOptions);
  world.registerSystem(RoomInputVisualSystem);
  world.registerSystem(RoomSystem);
  const room=world.getSystem(RoomSystem)!;
  desktop.onXRRequest=()=>{
   world.renderer.xr.setReferenceSpaceType('local-floor');
   world.launchXR();
   window.setTimeout(()=>{
    if(!world.renderer.xr.isPresenting)desktop.notify('空間表示を開始できませんでした。Questの権限を確認してください。');
   },8000);
  };
  const sync=()=>room.setLibrary(desktop.library.models);
  sync();desktop.library.addEventListener('change',sync);
  world.renderer.xr.addEventListener('sessionstart',()=>{xrContainer.style.zIndex='100';desktop.setImmersive(true);sync();});
  world.renderer.xr.addEventListener('sessionend',()=>{xrContainer.style.zIndex='-1';desktop.setImmersive(false);});
  desktop.setXRAvailable(!!(navigator.xr&&await navigator.xr.isSessionSupported('immersive-ar')));
 }catch(error){console.error('MRの準備に失敗しました',error);desktop.setXRAvailable(false);}
}
void initialize();
