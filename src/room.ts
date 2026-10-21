import {
 World, createSystem, Entity, Vector3, Quaternion, Mesh, MeshStandardMaterial,
 BoxGeometry, PhysicsBody, PhysicsShape, PhysicsShapeType, PhysicsState,
 PhysicsSystem, GrabSystem, Grabbed, TwoHandsGrabbable, RayInteractable,
 BoxHelper, FollowBehavior, Follower, UIKitMLAsset, VisibilityState,
 Object3D, EnvironmentRaycastTarget, RaycastSpace, PhysicsManipulation, Box3, XRMesh, MeshPhysicalMaterial, Color, Texture,
} from '@iwsdk/core';
import type { Slider } from '@pmndrs/uikit-horizon';
import { RoomModel } from './components';
import type { ModelRecord } from '../shared/models';
import { loadSTL, loadGLB, cloneModelScene, disposeParsed, type ParsedModel } from './model';
import { createAssembly, applyExplosion, type ExplodedPart } from './assembly';
import {indoorEnvironment,replaceSurface,surfaceMaterial} from './materials';
import {tableLift} from './surfaces';
import {renderThumbnail} from './thumbnail';
import {ModelPlayback} from './playback';
import type { AssemblyData } from '../shared/models';

const MAX_INSTANCES = 8;
const PAGE_SIZE=6;
export class RoomSystem extends createSystem({
 models: {required:[RoomModel]},
 held: {required:[RoomModel,Grabbed]},
 roomMeshes: {required:[XRMesh]},
}) {
 selected: Entity | null = null;
 library: ModelRecord[] = [];
 chosen: ModelRecord | null = null;
 page = 0;
 private controls!: UIKitMLAsset;
 private materialsPanel!:UIKitMLAsset;
 private environment!:Texture;
 private lastBottom=new Map<Entity,number>();
 private thumbs=new Map<string,string>();
 private thumbnailQueue:Promise<void>=Promise.resolve();
 private pendingThumbs=new Set<string>();
 private drag:{record:ModelRecord;start:Vector3;last:Vector3}|null=null;
 private libraryPanel!: UIKitMLAsset;
 private origin = new Vector3();
 private facing = new Quaternion();
 private forward = new Vector3();
 private scratch = new Vector3();
 private outline: BoxHelper | null = null;
 private outlineEntity: Entity | null = null;
 private surfaceProbe: Entity | null = null;
 private raySurface: Entity | null = null;
 private rebuiltBodies = new Map<Entity,{velocity:[number,number,number];angular:[number,number,number];gravity:number}>();
 private surfaces = new Map<XRPlane, Entity>();
 private floor: Entity | null = null;
 private active = false;
 private loading = false;
 private frameCount = 0;
 private initialPlaced = false;
 private onLibrary?: ()=>void;
 private renderedText=new Map<string,string>();
 private assemblies=new Map<Entity,ExplodedPart[]>();
 private playbacks=new Map<Entity,ModelPlayback>();
 private materialBounds=new Box3();
 private materialCenter=new Vector3();
 private explosionSlider!:Slider;

 init() {
  this.controls = this.world.requireSceneObject<UIKitMLAsset>('RoomControls');
  this.materialsPanel=this.world.requireSceneObject<UIKitMLAsset>('RoomMaterials');this.materialsPanel.visible=false;
  this.environment=indoorEnvironment(this.world.renderer);this.world.scene.environment=this.environment;
  this.cleanupFuncs.push(()=>{this.environment.dispose();if(this.world.scene.environment===this.environment)this.world.scene.environment=null;});
  this.libraryPanel = this.world.requireSceneObject<UIKitMLAsset>('RoomLibrary');
  const bind = (panel:UIKitMLAsset,id:string,fn:()=>void) => {
   const item=panel.requireElementById(id); item.name=id;
   item.addEventListener('click',fn);
   this.cleanupFuncs.push(()=>item.removeEventListener('click',fn));
  };
  bind(this.controls,'Reset',()=>this.resetSelected());
  bind(this.controls,'ActualSize',()=>this.resetSelected(true));
  bind(this.controls,'Delete',()=>this.deleteSelected());
  bind(this.controls,'Gravity',()=>this.toggleGravity());
  bind(this.controls,'Recall',()=>this.recallPanels());
  bind(this.materialsPanel,'AnimationPlay',()=>this.setAnimationPlaying(true));
  bind(this.materialsPanel,'AnimationStop',()=>this.setAnimationPlaying(false));
  for(const [id,preset] of [['Glass','glass'],['Aluminum','aluminum'],['SUS','sus'],['Plastic','plastic']])bind(this.materialsPanel,id,()=>this.setSurface(preset));
  for(const [i,color] of ['#e9ecef','#343a40','#c84646','#327dc4','#d6ad44','#529a70','#9964b2','#e48b47'].entries())bind(this.materialsPanel,`Color${i}`,()=>this.setSurface(undefined,color));
  bind(this.controls,'Explode',()=>{
   const entity=this.selected;if(!entity||!this.assemblies.has(entity))return;
   const open=!entity.getValue(RoomModel,'explosionOpen');
   entity.setValue(RoomModel,'explosionOpen',open);
   if(!open)this.setExplosion(0);this.renderExplosion();
  });
  this.explosionSlider=this.controls.requireElementById<Slider>('ExplosionSlider');
  this.explosionSlider.name='ExplosionSlider';
  this.explosionSlider.setProperties({onValueChange:value=>this.setExplosion(value/100)});
  // The kit defaults are sized for large pixel-authored panels; match this app's cm panel.
  this.explosionSlider.touchTarget.setProperties({height:6.4});
  this.explosionSlider.track.setProperties({height:1.2});
  this.explosionSlider.thumb.setProperties({height:1.2,minWidth:1.2});
  this.explosionSlider.progress.setProperties({paddingX:.2});
  this.explosionSlider.labels.setProperties({fontSize:1.2,lineHeight:1.6});
  this.cleanupFuncs.push(()=>this.explosionSlider.setProperties({onValueChange:undefined}));
  bind(this.libraryPanel,'Add',()=>void this.addChosen());
  bind(this.libraryPanel,'Previous',()=>{this.page=Math.max(0,this.page-1);this.renderLibrary();});
  bind(this.libraryPanel,'Next',()=>{this.page=Math.min(Math.ceil(this.library.length/PAGE_SIZE)-1,this.page+1);this.renderLibrary();});
  for(let i=0;i<PAGE_SIZE;i++) bind(this.libraryPanel,`Item${i}`,()=>{
   const record=this.library[this.page*PAGE_SIZE+i]; if(record){this.chosen=record;this.renderLibrary();}
  });
  for(let i=0;i<PAGE_SIZE;i++){
   const item=this.libraryPanel.requireElementById(`Item${i}`);
   const down=(event:any)=>{const record=this.library[this.page*PAGE_SIZE+i];if(!record||!event.point)return;this.drag={record,start:event.point.clone(),last:event.point.clone()};event.target?.setPointerCapture?.(event.pointerId);this.setLabel(this.libraryPanel,'DragHint','ドラッグして離すと正面に追加');};
   const move=(event:any)=>{if(this.drag&&event.point)this.drag.last.copy(event.point);};
   const up=()=>{const drag=this.drag;this.drag=null;this.setLabel(this.libraryPanel,'DragHint','サムネイルをドラッグして追加');if(drag&&drag.start.distanceTo(drag.last)>.07)void this.addChosen(undefined,drag.record);};
   const cancel=()=>{this.drag=null;};
   item.addEventListener('pointerdown',down);item.addEventListener('pointermove',move);item.addEventListener('pointerup',up);item.addEventListener('pointercancel',cancel);
   this.cleanupFuncs.push(()=>{item.removeEventListener('pointerdown',down);item.removeEventListener('pointermove',move);item.removeEventListener('pointerup',up);item.removeEventListener('pointercancel',cancel);});
  }
  this.cleanupFuncs.push(this.queries.held.subscribe('qualify',(entity)=>this.select(entity)));
  this.cleanupFuncs.push(this.queries.held.subscribe('disqualify',(entity)=>{
   if(entity.hasComponent(PhysicsBody)) entity.setValue(PhysicsBody,'gravityFactor',entity.getValue(RoomModel,'gravity')?1:0);
   if(!entity.getValue(RoomModel,'gravity'))this.rebuildCollider(entity,true);
  }));
  this.cleanupFuncs.push(this.world.visibilityState.subscribe((state)=>{
   const active=state!==VisibilityState.NonImmersive;
   if(active===this.active) return;
   this.active=active;
   if(!active) this.endSession();
   else this.initialPlaced=false;
   this.controls.visible=active; this.libraryPanel.visible=active;
  }));
  this.controls.visible=false;this.libraryPanel.visible=false;
  this.renderStaticLabels();
  this.renderExplosion();
  // UIKit's bundled glyph atlas has no Japanese coverage. Rasterize only labels
  // with the browser's native text shaper; buttons and hit testing remain UIKitML.
  const face=new FontFace('RoomJP',`url(${import.meta.env.BASE_URL}ui/fonts/NotoSansJP.ttf)`);
  void face.load().then(font=>{
   document.fonts.add(font);this.renderedText.clear();this.renderLibrary();this.renderStaticLabels();
   this.renderExplosion();
  }).catch(error=>console.warn('日本語フォントの読み込み',error));
 }
 setLibrary(models:ModelRecord[]) {
  this.library=models;
  this.chosen=models.find(m=>m.id===this.chosen?.id)??models[0]??null;
  this.renderLibrary();
 }
 private renderStaticLabels(){
  if(!this.selected)this.text('Selection','Quest3でSTLファイルを立体で見るアプリ');
  this.text('ResetLabel','位置・大きさを戻す');this.text('ActualSizeLabel','実寸にする');
  this.text('DeleteLabel','選択したモデルを消す');this.text('RecallLabel','操作画面を手元に呼ぶ');
  this.setLabel(this.libraryPanel,'DragHint','サムネイルをドラッグして追加');
  for(const [id,label] of [['MaterialTitle','表面の質感・色'],['GlassLabel','ガラス'],['AluminumLabel','アルミ'],['SUSLabel','SUS'],['PlasticLabel','プラスチック']])this.setLabel(this.materialsPanel,id,label);
  this.renderGravity();
  this.setLabel(this.materialsPanel,'AnimationPlayLabel','再生');this.setLabel(this.materialsPanel,'AnimationStopLabel','停止');
  this.renderPlayback();
  for(const [id,label] of [['LibraryTitle','モデルライブラリ'],['AddLabel','追加'],['PreviousLabel','前のモデル'],['NextLabel','次のモデル']]){
   this.setLabel(this.libraryPanel,id,label);
  }
 }
 private renderLibrary(){
  if(!this.libraryPanel) return;
  for(let i=0;i<PAGE_SIZE;i++){
   const model=this.library[this.page*PAGE_SIZE+i];
   this.setLabel(this.libraryPanel,`Name${i}`,model?.name??'');
   if(model){
    const src=model.thumbnailUrl??this.thumbs.get(model.id)??`${import.meta.env.BASE_URL}ui/placeholder.svg`;
    this.libraryPanel.getElementById(`Thumb${i}`)?.setProperties({src});
    if(!model.thumbnailUrl&&!this.thumbs.has(model.id)&&!this.pendingThumbs.has(model.id)){
     this.pendingThumbs.add(model.id);this.thumbnailQueue=this.thumbnailQueue.then(async()=>{
      if(!this.library.some(m=>m.id===model.id))return;
      let parsed:ParsedModel|undefined;try{parsed=await this.loadRecord(model);this.thumbs.set(model.id,renderThumbnail(this.world.renderer,parsed));this.renderLibrary();}catch{}finally{if(parsed)disposeParsed(parsed);this.pendingThumbs.delete(model.id);}
     });
    }
   }
   this.libraryPanel.requireElementById(`Item${i}`).setProperties({
    display:model?'flex':'none',backgroundColor:model?.id===this.chosen?.id?'#ccebee':'#edf1f2',
   });
  }
 }
 private text(id:string,text:string){this.setLabel(this.controls,id,text);}
 private setLabel(panel:UIKitMLAsset,id:string,text:string){
  if(this.renderedText.get(id)===text)return;
  const target=panel.getElementById(id);if(!target)return;
  const canvas=document.createElement('canvas');canvas.width=1000;canvas.height=80;
  const ctx=canvas.getContext('2d')!;ctx.fillStyle='#28343a';
  ctx.font='400 48px RoomJP, sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
  let label=text;while(ctx.measureText(label).width>940&&label.length>1)label=label.slice(0,-2)+'…';
  ctx.fillText(label,500,40);target.setProperties({src:canvas.toDataURL('image/png')});
  this.renderedText.set(id,text);
 }
 private async loadRecord(record:ModelRecord):Promise<ParsedModel>{
  const response=await fetch(record.modelUrl);if(!response.ok)throw new Error('モデルを読み込めませんでした');
  const parsed=await(record.format==='glb'?loadGLB:loadSTL)(await response.arrayBuffer());
  try{
   if(record.assemblyUrl){const response=await fetch(record.assemblyUrl);if(!response.ok)throw new Error('部品構成を読み込めませんでした');const assembly=await response.json() as AssemblyData;if(assembly.version!==1||assembly.parts.reduce((sum,p)=>sum+p.count,0)!==parsed.triangles)throw new Error('部品構成が一致しません');parsed.parts=assembly.parts;}
   return parsed;
  }catch(error){disposeParsed(parsed);throw error;}
 }
 private renderGravity(){
  const on=!!this.selected?.getValue(RoomModel,'gravity');this.text('GravityLabel',`重力 ${on?'ON':'OFF'}`);
  this.controls.getElementById('Gravity')?.setProperties({backgroundColor:on?'#b9dfe4':'#e5f2f4'});
 }
 private toggleGravity(){
  const entity=this.selected;if(!entity)return;
  const on=!entity.getValue(RoomModel,'gravity');entity.setValue(RoomModel,'gravity',on);
  if(entity.hasComponent(PhysicsBody))entity.setValue(PhysicsBody,'gravityFactor',on?1:0);
  this.rebuildCollider(entity,!on);
  const pending=this.rebuiltBodies.get(entity);if(pending)pending.gravity=on?1:0;
  this.renderGravity();
 }
 private setSurface(preset?:string,tint?:string){
  const entity=this.selected;if(!entity?.object3D)return;
  const chosen=preset??(entity.getValue(RoomModel,'materialPreset')==='original'?'plastic':entity.getValue(RoomModel,'materialPreset')??'plastic');
  const color=tint??entity.getValue(RoomModel,'tint')??'#b4b9bc';
  replaceSurface(entity.object3D,chosen,color);entity.setValue(RoomModel,'materialPreset',chosen);entity.setValue(RoomModel,'tint',color);
  for(const [id,name] of [['Glass','glass'],['Aluminum','aluminum'],['SUS','sus'],['Plastic','plastic']])this.materialsPanel.getElementById(id)?.setProperties({backgroundColor:chosen===name?'#b9dfe4':'#e5f2f4'});
 }
 private setAnimationPlaying(playing:boolean){
  const entity=this.selected,playback=entity?this.playbacks.get(entity):undefined;if(!entity||!playback)return;
  playback.setPlaying(playing);entity.setValue(RoomModel,'animationPlaying',playback.playing);this.renderPlayback();
 }
 private renderPlayback(){
  const playback=this.selected?this.playbacks.get(this.selected):undefined;
  this.materialsPanel.getElementById('AnimationControls')?.setProperties({display:playback?.count?'flex':'none'});
  this.materialsPanel.getElementById('AnimationPlay')?.setProperties({backgroundColor:playback?.playing?'#b9dfe4':'#e5f2f4'});
  this.materialsPanel.getElementById('AnimationStop')?.setProperties({backgroundColor:playback&&!playback.playing?'#b9dfe4':'#e5f2f4'});
 }
 private placeMaterialPanel(){
  const object=this.selected?.object3D;if(!object||!this.active){this.materialsPanel.visible=false;return;}
  const animated=!!this.playbacks.get(this.selected!)?.count;
  const bounds=this.materialBounds;
  let clearance=.17;
  if(animated){
   // Skin bounds cache the initial pose. Keep controls stable above that pose,
   // with room for moving limbs, rather than letting the menu bob with the clip.
   const e=this.selected!.getVectorView(RoomModel,'extents');
   bounds.min.set(-e[0]/2,-e[1]/2,-e[2]/2);bounds.max.set(e[0]/2,e[1]/2,e[2]/2);
   object.updateWorldMatrix(true,false);bounds.applyMatrix4(object.matrixWorld);
   clearance+=Math.max(.12,Math.min(.35,Math.max(e[0],e[1],e[2])*object.scale.x*.5));
  }else bounds.setFromObject(object);
  const center=bounds.getCenter(this.materialCenter);
  this.player.head.getWorldPosition(this.scratch);this.player.head.getWorldQuaternion(this.facing);
  const right=new Vector3(1,0,0).applyQuaternion(this.facing);right.y=0;right.normalize();
  this.materialsPanel.position.copy(center);this.materialsPanel.position.y=bounds.max.y+clearance;this.materialsPanel.scale.setScalar(.75);this.materialsPanel.lookAt(this.scratch);this.materialsPanel.visible=true;
 }
 private recallPanels(){
  this.player.head.getWorldPosition(this.origin);this.player.head.getWorldQuaternion(this.facing);
  const yaw=2*Math.atan2(this.facing.y,this.facing.w);this.facing.setFromAxisAngle(new Vector3(0,1,0),yaw);
  this.libraryPanel.position.set(.6,-.04,-1.2).applyQuaternion(this.facing).add(this.origin);this.libraryPanel.lookAt(this.origin);
  this.controls.position.set(-.64,-.04,-.9).applyQuaternion(this.facing).add(this.origin);this.controls.lookAt(this.origin);
 }
 private syncMeshColliders(){
  for(const entity of this.queries.roomMeshes.entities){
   if(!entity.object3D||entity.hasComponent(PhysicsBody))continue;
   entity.addComponent(PhysicsShape,{shape:PhysicsShapeType.TriMesh});entity.addComponent(PhysicsBody,{state:PhysicsState.Static});
  }
 }
 private constrainToSurfaces(entity:Entity){
  const object=entity.object3D;if(!object)return;
  const bounds=new Box3().setFromObject(object),previous=this.lastBottom.get(entity)??bounds.min.y;
  const candidates=[...this.surfaces.values(),...(this.raySurface?[this.raySurface]:[])];
  let lift=0;
  for(const surface of candidates){if(surface.object3D)lift=Math.max(lift,tableLift(previous,bounds,new Box3().setFromObject(surface.object3D)));}
  for(const mesh of this.queries.roomMeshes.entities){
   if(!mesh.object3D||!/(table|desk|counter)/i.test(mesh.getValue(XRMesh,'semanticLabel')??''))continue;
   lift=Math.max(lift,tableLift(previous,bounds,new Box3().setFromObject(mesh.object3D)));
  }
  if(lift>0){
   object.position.y+=lift;
   if(entity.hasComponent(PhysicsBody))this.world.getSystem(PhysicsSystem)!.setBodyTransform(entity,{position:object.position,quaternion:object.quaternion});
   if(!entity.hasComponent(Grabbed)){
    if(!entity.hasComponent(PhysicsManipulation))entity.addComponent(PhysicsManipulation,{linearVelocity:[0,0,0],angularVelocity:[0,0,0]});
    else{entity.getVectorView(PhysicsManipulation,'linearVelocity').fill(0);entity.getVectorView(PhysicsManipulation,'angularVelocity').fill(0);}
   }
  }
  this.lastBottom.set(entity,bounds.min.y+lift);
 }
 async addChosen(parsed?:ParsedModel,recordOverride?:ModelRecord) {
  const selectedRecord=recordOverride??this.chosen;
  if(!selectedRecord||this.loading) return;
  if(this.queries.models.entities.size>=MAX_INSTANCES){this.text('Selection','モデルは8個まで追加できます');return;}
  let triangles=selectedRecord.optimization?.triangles??selectedRecord.triangles;
  for(const entity of this.queries.models.entities)triangles+=entity.getValue(RoomModel,'triangles')??0;
  if(triangles>1_000_000){this.text('Selection','モデルを減らすか、形状を簡略化してください');return;}
  this.loading=true;
  const record=selectedRecord;
  try{
   let owned=false;
   if(!parsed){
    parsed=await this.loadRecord(record);owned=true;
   }
   if(!this.active){if(owned)disposeParsed(parsed);return;}
   const material=surfaceMaterial('plastic','#b4b9bc');
   const assembly=parsed.parts&&parsed.parts.length>1?createAssembly(parsed,material):undefined;
   const mesh=parsed.scene?cloneModelScene(parsed.scene):assembly?.group??new Mesh(parsed.geometry.clone(),material);
   if(parsed.scene)material.dispose();
   if(owned)disposeParsed(parsed);
   mesh.name=`STL ${record.name}`;
   const max=Math.max(record.dimensions.width,record.dimensions.depth,record.dimensions.height)*.001;
   const scale=max>.35?.28/max:max<.04?.1/max:1;
   mesh.scale.setScalar(scale);
   this.player.head.getWorldPosition(this.origin);this.player.head.getWorldQuaternion(this.facing);
   this.forward.set(0,0,-1).applyQuaternion(this.facing).normalize();
   mesh.position.copy(this.origin).addScaledVector(this.forward,.6);mesh.position.y-=.05;
   mesh.quaternion.identity();
   const entity=this.world.createTransformEntity(mesh,{persistent:true});
   const extents:[number,number,number]=[Math.max(.001,record.dimensions.width*.001),Math.max(.001,record.dimensions.height*.001),Math.max(.001,record.dimensions.depth*.001)];
   const playback=mesh.animations.length?new ModelPlayback(mesh):undefined;
   entity.addComponent(RoomModel,{assetId:record.id,homePosition:mesh.position.toArray(),homeScale:scale,colliderScale:scale,extents,triangles:parsed.triangles,partCount:assembly?.parts.length??1,materialPreset:parsed.scene?'original':'plastic',animationCount:playback?.count??0,animationPlaying:playback?.playing??false});
   if(playback)this.playbacks.set(entity,playback);
   if(assembly)this.assemblies.set(entity,assembly.parts);
   entity.addComponent(RayInteractable);
   entity.addComponent(TwoHandsGrabbable,{translate:true,rotate:true,scale:true});
   entity.addComponent(PhysicsShape,{shape:PhysicsShapeType.Box,
    dimensions:[extents[0]*scale,extents[1]*scale,extents[2]*scale],friction:.65,restitution:.12});
   entity.addComponent(PhysicsBody,{state:PhysicsState.Kinematic,gravityFactor:0,linearDamping:.12,angularDamping:.15});
   this.select(entity);
  }catch(error){console.error(error);this.text('Selection','モデルを読み込めませんでした');}
  finally{this.loading=false;}
 }
 private select(entity:Entity){
  this.selected=entity;
  this.outlineEntity?.dispose();
  this.outline=new BoxHelper(entity.object3D!,0x7bbdc8);
  this.outlineEntity=this.world.createTransformEntity(this.outline,{persistent:true});
  const record=this.library.find(m=>m.id===entity.getValue(RoomModel,'assetId'));
  this.text('Selection',record?.name??'Quest3でSTLファイルを立体で見るアプリ');
  this.renderExplosion();this.renderGravity();this.renderPlayback();this.materialsPanel.visible=true;
 }
 private renderExplosion(){
  const entity=this.selected,available=!!entity&&this.assemblies.has(entity);
  const open=available&&entity!.getValue(RoomModel,'explosionOpen');
  const value=available?entity!.getValue(RoomModel,'explosion')??0:0;
  this.controls.getElementById('ExplosionControls')?.setProperties({display:open?'flex':'none'});
  this.controls.getElementById('Explode')?.setProperties({opacity:available?1:.45,backgroundColor:open?'#b9dfe4':'#e5f2f4'});
  this.text('ExplodeLabel',available?open?'爆発図を閉じる':'爆発図':'爆発図 STEPの複数部品で利用');
  this.text('ExplosionValue',`分離量 ${Math.round(value*100)}%  0%で組立に戻る`);
  this.explosionSlider?.setProperties({value:Math.round(value*100)});
 }
 private setExplosion(value:number){
  const entity=this.selected,parts=entity?this.assemblies.get(entity):undefined;
  if(!entity?.object3D||!parts)return;
  const amount=Math.max(0,Math.min(1,Number.isFinite(value)?value:0));
  this.world.getSystem(GrabSystem)?.forceRelease(entity);
  const extents=entity.getVectorView(RoomModel,'extents'),oldSize=Math.max(...extents);
  applyExplosion(parts,amount);
  const bounds=new Box3();
  for(const part of parts){
   const box=part.mesh.geometry.boundingBox!.clone().translate(part.mesh.position);bounds.union(box);
  }
  for(let axis=0;axis<3;axis++)extents[axis]=Math.max(.001,2*Math.max(Math.abs(bounds.min.getComponent(axis)),Math.abs(bounds.max.getComponent(axis))));
  // Keep the whole exploded assembly within its previous viewing envelope.
  entity.object3D.scale.multiplyScalar(oldSize/Math.max(...extents));
  entity.setValue(RoomModel,'explosion',amount);
  this.rebuildCollider(entity,true);this.renderExplosion();
 }
 resetSelected(actualSize=false){
  const entity=this.selected;if(!entity?.object3D)return;
  this.world.getSystem(GrabSystem)?.forceRelease(entity);
  this.setExplosion(0);entity.setValue(RoomModel,'explosionOpen',false);this.renderExplosion();
  const home=entity.getVectorView(RoomModel,'homePosition');
  this.scratch.set(home[0],home[1],home[2]);
  entity.object3D.scale.setScalar(actualSize?1:(entity.getValue(RoomModel,'homeScale')??1));
  if(entity.hasComponent(PhysicsBody)){
   entity.setValue(PhysicsBody,'gravityFactor',0);
   this.world.getSystem(PhysicsSystem)!.setBodyTransform(entity,{position:this.scratch,quaternion:new Quaternion()});
  }
  entity.object3D.position.copy(this.scratch);entity.object3D.quaternion.identity();
  this.rebuildCollider(entity,true);
 }
 deleteSelected(){
  const entity=this.selected;if(!entity)return;
  this.world.getSystem(GrabSystem)?.forceRelease(entity);
  this.playbacks.get(entity)?.dispose();this.playbacks.delete(entity);
  this.selected=null;entity.dispose();this.lastBottom.delete(entity);this.materialsPanel.visible=false;
  this.assemblies.delete(entity);this.renderExplosion();
  this.rebuiltBodies.delete(entity);
  this.outlineEntity?.dispose();this.outlineEntity=null;this.outline=null;
  this.text('Selection','モデルを追加できます');this.text('Scale','');
 }
 private placePanels(){
  this.player.head.getWorldPosition(this.origin);this.player.head.getWorldQuaternion(this.facing);
  const yaw=2*Math.atan2(this.facing.y,this.facing.w);
  this.facing.setFromAxisAngle(this.scratch.set(0,1,0),yaw);
  const right=this.libraryPanel;
  right.position.set(.6,-.04,-1.2).applyQuaternion(this.facing).add(this.origin);
  right.lookAt(this.origin);
  const controlEntity=this.world.requireSceneEntity('RoomControls');
  if(!controlEntity.hasComponent(Follower))controlEntity.addComponent(Follower,{
   target:this.player.head,offsetPosition:[-.64,-.04,-.9],behavior:FollowBehavior.PivotY,speed:1.3,tolerance:.28,maxAngle:25,
  });
  this.controls.position.set(-.64,-.04,-.9).applyQuaternion(this.facing).add(this.origin);
  this.controls.lookAt(this.origin);
  const floorMesh=new Mesh(new BoxGeometry(40,.1,40),new MeshStandardMaterial({visible:false}));
  floorMesh.position.y=-.05;floorMesh.name='SafetyFloor';
  this.floor=this.world.createTransformEntity(floorMesh,{persistent:true});
  this.floor.addComponent(PhysicsShape,{shape:PhysicsShapeType.Box,dimensions:[40,.1,40],friction:.7,restitution:.1});
  this.floor.addComponent(PhysicsBody,{state:PhysicsState.Static});
  this.surfaceProbe=this.world.createTransformEntity(new Object3D(),{persistent:true});
  this.surfaceProbe.object3D!.name='RoomEnvironmentProbe';
  this.surfaceProbe.addComponent(EnvironmentRaycastTarget,{
   space:RaycastSpace.Viewer,maxDistance:4,
   offsetQuaternion:new Quaternion().setFromAxisAngle(new Vector3(1,0,0),-Math.PI/5),
  });
  this.initialPlaced=true;void this.addChosen();
 }
 private syncSurfaces(){
  const frame=this.world.renderer.xr.getFrame();
  const reference=this.world.renderer.xr.getReferenceSpace();
  if(!frame||!reference)return;
  const planes=frame.detectedPlanes;
  this.syncRaySurface(frame,reference);
  if(!planes?.size){this.text('Surface',this.raySurface?'認識した面を使用中':'仮想の床を使用中');return;}
  for(const [plane,entity] of this.surfaces){if(!planes.has(plane)){entity.dispose();this.surfaces.delete(plane);}}
  for(const plane of planes){
   if(plane.orientation!=='horizontal'||this.surfaces.has(plane)||this.surfaces.size>=32)continue;
   const pose=frame.getPose(plane.planeSpace,reference);if(!pose||plane.polygon.length<3)continue;
   let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;
   for(const p of plane.polygon){minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);minZ=Math.min(minZ,p.z);maxZ=Math.max(maxZ,p.z);}
   const w=maxX-minX,d=maxZ-minZ;if(w<.1||d<.1)continue;
   const mesh=new Mesh(new BoxGeometry(w,.025,d),new MeshStandardMaterial({visible:false}));
   mesh.quaternion.set(pose.transform.orientation.x,pose.transform.orientation.y,pose.transform.orientation.z,pose.transform.orientation.w);
   mesh.position.set((minX+maxX)/2,-.0125,(minZ+maxZ)/2).applyQuaternion(mesh.quaternion);
   mesh.position.add(this.scratch.set(pose.transform.position.x,pose.transform.position.y,pose.transform.position.z));
   mesh.name=`RoomSurface ${plane.semanticLabel??'horizontal'}`;
   const entity=this.world.createTransformEntity(mesh,{persistent:true});
   entity.addComponent(PhysicsShape,{shape:PhysicsShapeType.Box,dimensions:[w,.025,d],friction:.7,restitution:.1});
   entity.addComponent(PhysicsBody,{state:PhysicsState.Static});this.surfaces.set(plane,entity);
  }
  this.text('Surface',`認識面 ${this.surfaces.size} / 家具 ${this.queries.roomMeshes.entities.size}`);
 }
 private syncRaySurface(frame:XRFrame,reference:XRReferenceSpace){
  const result=this.surfaceProbe?.getValue(EnvironmentRaycastTarget,'xrHitTestResult') as XRHitTestResult|undefined;
  const pose=result?.getPose(reference);if(!pose)return;
  this.facing.set(pose.transform.orientation.x,pose.transform.orientation.y,pose.transform.orientation.z,pose.transform.orientation.w);
  this.scratch.set(0,1,0).applyQuaternion(this.facing);if(this.scratch.y<.95)return;
  if(!this.raySurface){
   const mesh=new Mesh(new BoxGeometry(.5,.025,.5),new MeshStandardMaterial({visible:false}));
   mesh.name='EnvironmentRaycastSurface';
   this.raySurface=this.world.createTransformEntity(mesh,{persistent:true});
   this.raySurface.addComponent(PhysicsShape,{shape:PhysicsShapeType.Box,dimensions:[.5,.025,.5],friction:.7});
   this.raySurface.addComponent(PhysicsBody,{state:PhysicsState.Static});
  }
  this.scratch.set(pose.transform.position.x,pose.transform.position.y-.0125,pose.transform.position.z);
  this.world.getSystem(PhysicsSystem)!.setBodyTransform(this.raySurface,{position:this.scratch,quaternion:this.facing});
 }
 private rebuildCollider(entity:Entity,reset=false){
  if(!entity.object3D||!entity.hasComponent(PhysicsBody))return;
  // IWSDK 1.0.1 does not resize Havok shapes when Object3D.scale changes.
  // Remove the body for one ECS tick, then recreate its box at the measured size.
  const v=entity.getVectorView(PhysicsBody,'_linearVelocity');
  const a=entity.getVectorView(PhysicsBody,'_angularVelocity');
  const velocity:[number,number,number]=reset?[0,0,0]:[v[0],v[1],v[2]];
  const angular:[number,number,number]=reset?[0,0,0]:[a[0],a[1],a[2]];
  const gravity=entity.getValue(RoomModel,'gravity')?1:0;
  this.rebuiltBodies.set(entity,{velocity,angular,gravity});
  entity.removeComponent(PhysicsBody);
  const extents=entity.getVectorView(RoomModel,'extents');
  const dimensions=entity.getVectorView(PhysicsShape,'dimensions');
  for(let i=0;i<3;i++)dimensions[i]=extents[i]*entity.object3D.scale.x;
  entity.setValue(RoomModel,'colliderScale',entity.object3D.scale.x);
 }
 update(delta:number){
  if(!this.active)return;
  for(const [entity,playback] of this.playbacks){if(this.queries.models.entities.has(entity))playback.update(delta);}
  for(const [entity,saved] of this.rebuiltBodies){
   entity.addComponent(PhysicsBody,{state:entity.getValue(RoomModel,'gravity')?PhysicsState.Dynamic:PhysicsState.Kinematic,gravityFactor:saved.gravity,linearDamping:.12,angularDamping:.15});
   entity.addComponent(PhysicsManipulation,{linearVelocity:saved.velocity,angularVelocity:saved.angular});
  }
  this.rebuiltBodies.clear();
  if(!this.initialPlaced)this.placePanels();
  this.outline?.update();
  if(this.selected?.object3D)this.text('Scale',`倍率 ${Math.round(this.selected.object3D.scale.x*100)}%`);
  if(++this.frameCount%15===0){this.syncSurfaces();this.syncMeshColliders();}
  this.placeMaterialPanel();
  for(const entity of this.queries.models.entities){
   const object=entity.object3D;if(!object)continue;
   object.scale.setScalar(Math.max(.001,Math.min(100,object.scale.x)));
   const previous=entity.getValue(RoomModel,'colliderScale')??1;
   if(Math.abs(object.scale.x-previous)>Math.max(.00001,previous*.01))this.rebuildCollider(entity);
   this.constrainToSurfaces(entity);
   if(entity.hasComponent(Grabbed))continue;
   if((entity.getValue(RoomModel,'gravity')&&object.position.y < -5) || object.position.distanceToSquared(this.origin)>2500){this.selected=entity;this.resetSelected();}
  }
 }
 private endSession(){
  for(const playback of this.playbacks.values())playback.dispose();this.playbacks.clear();
  this.selected=null;this.drag=null;this.lastBottom.clear();this.materialsPanel.visible=false;
  this.assemblies.clear();this.renderExplosion();
  for(const entity of [...this.queries.models.entities])entity.dispose();
  for(const entity of this.surfaces.values())entity.dispose();this.surfaces.clear();
  this.floor?.dispose();this.floor=null;
  this.outlineEntity?.dispose();this.outlineEntity=null;this.outline=null;
  this.surfaceProbe?.dispose();this.surfaceProbe=null;this.raySurface?.dispose();this.raySurface=null;
  this.rebuiltBodies.clear();
  this.world.requireSceneEntity('RoomControls').removeComponent(Follower);
  this.initialPlaced=false;
 }
}

