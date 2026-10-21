import { Color, createSystem, Entity, Grabbed, Matrix4, PerspectiveCamera, SRGBColorSpace, UIKitMLAsset, Vector3, Vector4, VisibilityState, WebGLRenderTarget } from '@iwsdk/core';
import { RoomPhotoCapture } from './components';
import { FrameGesture, FrameShutter, type FrameHand } from './photo-gesture';
import { RoomSystem } from './room';
import { uploadPhoto } from './photos';
const joints=['index-finger-phalanx-proximal','index-finger-tip','thumb-phalanx-proximal','thumb-tip'] as const;

export class RoomPhotoSystem extends createSystem({held:{required:[Grabbed]}}){
 private state!:Entity;private panel!:UIKitMLAsset;private room!:RoomSystem;
 private gesture=new FrameGesture();private shutter=new FrameShutter();
 private left:FrameHand={indexBase:new Vector3(),index:new Vector3(),thumbBase:new Vector3(),thumb:new Vector3()};
 private right:FrameHand={indexBase:new Vector3(),index:new Vector3(),thumbBase:new Vector3(),thumb:new Vector3()};
 private leftPoints=[this.left.indexBase,this.left.index,this.left.thumbBase,this.left.thumb];
 private rightPoints=[this.right.indexBase,this.right.index,this.right.thumbBase,this.right.thumb];
 private inverse=new Matrix4();private snapshotCamera=new PerspectiveCamera();
 private enabled=true;private busy=false;private pending:{id:string;blob:Blob}|null=null;private lastLabel='';private lastStage='';
 private background=new Color('#edf0f3');private statusUntil=0;
 init(){
  this.room=this.world.getSystem(RoomSystem)!;this.state=this.world.requireSceneEntity('RoomControls');this.state.addComponent(RoomPhotoCapture);
  this.panel=this.world.requireSceneObject<UIKitMLAsset>('RoomControls');
  const button=this.panel.requireElementById('Photo');button.name='Photo';
  const click=()=>{if(this.busy)return;if(this.pending){void this.save();return;}this.enabled=!this.enabled;this.shutter.reset();this.state.setValue(RoomPhotoCapture,'stage',this.enabled?'ready':'off');this.feedback();};
  button.addEventListener('click',click);this.cleanupFuncs.push(()=>button.removeEventListener('click',click));
  this.cleanupFuncs.push(this.world.visibilityState.subscribe(value=>{if(value!==VisibilityState.Visible){this.shutter.reset();this.state.setValue(RoomPhotoCapture,'progress',0);if(!this.busy&&!this.pending)this.state.setValue(RoomPhotoCapture,'stage',this.enabled?'ready':'off');this.feedback();}}));
  this.feedback();
 }
 private feedback(){
  const stage=this.state.getValue(RoomPhotoCapture,'stage'),p=this.state.getValue(RoomPhotoCapture,'progress')??0;
  const text=stage==='error'?(this.pending?'保存失敗 / 押して再保存':'撮影失敗 / もう一度四角'):stage==='saving'?'写真を保存中…':stage==='saved'?'写真を保存しました':stage==='holding'?`撮影まで ${Math.max(1,Math.ceil((1-p)*1.2))}秒`:this.enabled?'写真 ON / 両手で四角':'写真ジェスチャ OFF';
  if(this.lastLabel!==text){this.room.setControlLabel('PhotoLabel',text);this.lastLabel=text;}
  if(this.lastStage!==stage){this.panel.getElementById('Photo')?.setProperties({backgroundColor:stage==='error'?'#ffd1d1':stage==='saved'?'#a7e4c7':stage==='holding'||stage==='saving'?'#ffe398':'#e5f2f4'});this.lastStage=stage??'';}
 }
 private read(side:'left'|'right'):boolean{
  const xr=this.world.renderer.xr,source=this.input.xr.getPrimaryInputSource(side),space=xr.getReferenceSpace(),frame=xr.getFrame();
  if(!source?.hand||!space||!frame)return false;
  const targets=side==='left'?this.leftPoints:this.rightPoints;
  for(let i=0;i<joints.length;i++){
   const joint=source.hand.get(joints[i]),pose=joint&&frame.getJointPose?.(joint,space);if(!pose)return false;
   targets[i].set(pose.transform.position.x,pose.transform.position.y,pose.transform.position.z);
   this.player.localToWorld(targets[i]);targets[i].applyMatrix4(this.inverse);
  }
  return true;
 }
 update(delta:number){
  if(!this.world.renderer.xr.isPresenting||this.world.visibilityState.peek()!==VisibilityState.Visible)return;
  if(this.busy)return;
  this.player.head.updateWorldMatrix(true,false);this.inverse.copy(this.player.head.matrixWorld).invert();
  const valid=this.enabled&&!this.pending&&this.queries.held.entities.size===0&&this.read('left')&&this.read('right')&&this.gesture.matches(this.left,this.right);
  const fire=this.shutter.update(valid,delta);this.state.setValue(RoomPhotoCapture,'progress',this.shutter.progress);
  if(fire){void this.capture();return;}
  if(this.pending)return;
  const stage=this.shutter.progress>0?'holding':performance.now()<this.statusUntil?(this.state.getValue(RoomPhotoCapture,'stage')??'ready'):this.enabled?'ready':'off';
  if(stage!==this.state.getValue(RoomPhotoCapture,'stage'))this.state.setValue(RoomPhotoCapture,'stage',stage);
  this.feedback();
 }
 private async capture(){
  this.busy=true;this.state.setValue(RoomPhotoCapture,'stage','saving');this.feedback();
  try{
   // Render one eye's current pose into an owned target. XR's OS-composited
   // passthrough is not readable; never claim that the neutral background is a room photo.
   const renderer=this.world.renderer,xrCamera=renderer.xr.getCamera(),eye=xrCamera.cameras[0];
   if(!eye)throw new Error('撮影する視点がありません。');
   this.snapshotCamera.matrixAutoUpdate=false;this.snapshotCamera.matrix.copy(eye.matrixWorld);this.snapshotCamera.matrixWorld.copy(eye.matrixWorld);this.snapshotCamera.matrixWorldInverse.copy(eye.matrixWorldInverse);
   this.snapshotCamera.projectionMatrix.copy(eye.projectionMatrix);this.snapshotCamera.projectionMatrixInverse.copy(eye.projectionMatrixInverse);this.snapshotCamera.layers.mask=eye.layers.mask;
   const aspect=eye.projectionMatrix.elements[5]/eye.projectionMatrix.elements[0];
   if(!Number.isFinite(aspect)||aspect<=0)throw new Error('撮影する視点がありません。');
   const height=Math.round(Math.min(1280,1600/aspect)),width=Math.round(height*aspect);
   const target=new WebGLRenderTarget(width,height);target.texture.colorSpace=SRGBColorSpace;
   const previousTarget=renderer.getRenderTarget(),previousBackground=this.world.scene.background,xrEnabled=renderer.xr.enabled,previousAutoClear=renderer.autoClear,viewport=renderer.getViewport(new Vector4()),scissor=renderer.getScissor(new Vector4()),scissorTest=renderer.getScissorTest();
   const bytes=new Uint8Array(width*height*4);
   try{
    renderer.xr.enabled=false;renderer.autoClear=true;this.world.scene.background=this.background;
    renderer.setRenderTarget(target);renderer.render(this.world.scene,this.snapshotCamera);renderer.readRenderTargetPixels(target,0,0,width,height,bytes);
   }finally{renderer.setRenderTarget(previousTarget);renderer.setViewport(viewport);renderer.setScissor(scissor);renderer.setScissorTest(scissorTest);renderer.xr.enabled=xrEnabled;renderer.autoClear=previousAutoClear;this.world.scene.background=previousBackground;target.dispose();}
   const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d');if(!ctx)throw new Error('写真を生成できませんでした。');
   const image=ctx.createImageData(width,height),row=width*4;
   for(let y=0;y<height;y++)image.data.set(bytes.subarray((height-y-1)*row,(height-y)*row),y*row);
   ctx.putImageData(image,0,0);
   const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('写真を生成できませんでした。')),'image/jpeg',.9));
   this.pending={id:crypto.randomUUID(),blob};this.busy=false;await this.save();
  }catch{this.busy=false;this.state.setValue(RoomPhotoCapture,'stage','error');this.lastLabel='';this.feedback();this.statusUntil=performance.now()+4000;}
 }
 private async save(){
  if(!this.pending||this.busy)return;this.busy=true;this.state.setValue(RoomPhotoCapture,'stage','saving');this.feedback();
  try{const photo=await uploadPhoto(this.pending.id,this.pending.blob);this.pending=null;this.state.setValue(RoomPhotoCapture,'photoId',photo.id);this.state.setValue(RoomPhotoCapture,'stage','saved');this.statusUntil=performance.now()+4000;}
  catch{this.state.setValue(RoomPhotoCapture,'stage','error');}
  finally{this.busy=false;this.feedback();}
 }
}
