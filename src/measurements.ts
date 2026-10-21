import {createSystem,Entity,Group,Mesh,SkinnedMesh,Vector3,Triangle,Sprite,SpriteMaterial,CanvasTexture,VisibilityState,UIKitMLAsset,RayInteractable,PokeInteractable,Object3D,BufferGeometry,Float32BufferAttribute,MeshBasicMaterial,DoubleSide} from '@iwsdk/core';
import {MeshBVH,acceleratedRaycast} from 'three-mesh-bvh';
import {RoomModel,RoomDimension,RoomMeasurementMode} from './components';
import {RoomSystem} from './room';
import {dimensionCord,dimensionHit,dimensionLaser} from './scene-assets/dimension.scene-asset';

type Pick={object:Object3D;point:Vector3;pointOnFace?:Vector3;face?:{a:number;b:number;c:number}|null};
interface Anchor {model:Entity;mesh:Mesh;point:Vector3;indices?:[number,number,number];weights?:Vector3;}
interface DimensionView {start:Anchor;end:Anchor;cord:Group;a:Group;b:Group;label:Sprite;canvas:HTMLCanvasElement;texture:CanvasTexture;text:string;}
const UP=new Vector3(0,1,0);

export class RoomMeasurementSystem extends createSystem({models:{required:[RoomModel]},dimensions:{required:[RoomDimension]}}){
 private room!:RoomSystem;
 private panel!:UIKitMLAsset;
 private state!:Entity;
 private roots=new Map<Group|Mesh,Entity>();
 private views=new Map<Entity,DimensionView>();
 private proxies=new Map<Entity,{entity:Entity;root:Group;meshes:Mesh[]}>();
 private proxyMeshes=new Map<Mesh,Mesh>();
 private contact:Pick={object:new Object3D(),point:new Vector3(),face:{a:0,b:0,c:0}};
 private nearest={point:new Vector3(),distance:0,faceIndex:0};
 private touchLatched=false;
 private visuals!:Entity;
 private live!:Group;
 private cord!:Group;
 private laser!:Group;
 private target!:Group;
 private glow!:Sprite;
 private first:Anchor|null=null;
 private lastPressed=true;
 private frame=0;
 private origin=new Vector3();private end=new Vector3();private a=new Vector3();private b=new Vector3();
 private direction=new Vector3();private va=new Vector3();private vb=new Vector3();private vc=new Vector3();private localA=new Vector3();private localB=new Vector3();
 getRightPointer(){return this.input.xr.multiPointers.right.getPointer('ray');}
 init(){
  this.room=this.world.getSystem(RoomSystem)!;
  this.panel=this.world.requireSceneObject<UIKitMLAsset>('RoomControls');
  this.state=this.world.requireSceneEntity('RoomControls');this.state.addComponent(RoomMeasurementMode);
  const bind=(id:string,fn:()=>void)=>{const button=this.panel.requireElementById(id);button.name=id;button.addEventListener('click',fn);this.cleanupFuncs.push(()=>button.removeEventListener('click',fn));};
  bind('Measure',()=>this.setMode(!this.state.getValue(RoomMeasurementMode,'active')));
  bind('MeasureAdd',()=>this.beginNext());bind('MeasureReset',()=>this.reset());
  this.cleanupFuncs.push(this.queries.models.subscribe('qualify',entity=>{if(entity.object3D)this.roots.set(entity.object3D as Group,entity);}));
  this.cleanupFuncs.push(this.queries.models.subscribe('disqualify',entity=>{
   if(entity.object3D)this.roots.delete(entity.object3D as Group);
   if(this.first?.model===entity)this.first=null;
   for(const [line,view] of this.views)if(view.start.model===entity)this.removeLine(line,view);
   this.refreshCount();
  }));
  for(const entity of this.queries.models.entities)if(entity.object3D)this.roots.set(entity.object3D as Group,entity);
  this.live=new Group();this.live.name='Measurement right hand tool';
  this.cord=dimensionCord.clone(true);this.laser=dimensionLaser.clone(true);this.target=dimensionHit.clone(true);
  const canvas=document.createElement('canvas');canvas.width=canvas.height=128;const ctx=canvas.getContext('2d')!;
  const gradient=ctx.createRadialGradient(64,64,2,64,64,64);gradient.addColorStop(0,'#ff183b');gradient.addColorStop(.22,'#ff183bbb');gradient.addColorStop(1,'#ff183b00');ctx.fillStyle=gradient;ctx.fillRect(0,0,128,128);
  const texture=new CanvasTexture(canvas),material=new SpriteMaterial({map:texture,transparent:true,depthTest:false,depthWrite:false});
  this.glow=new Sprite(material);this.glow.name='Red hit glow';this.glow.scale.set(.026,.026,1);this.glow.renderOrder=1203;
  this.live.add(this.cord,this.laser,this.target,this.glow);this.live.visible=false;
  this.visuals=this.world.createTransformEntity(this.live,{persistent:true});
  this.cleanupFuncs.push(()=>{texture.dispose();material.dispose();});
  this.cleanupFuncs.push(this.world.visibilityState.subscribe(value=>{if(value===VisibilityState.NonImmersive){this.setMode(false);this.clearLines();}}));
  this.renderUI();
 }
 private label(id:string,text:string){this.room.setControlLabel(id,text);}
 private renderUI(){
  const active=this.state.getValue(RoomMeasurementMode,'active'),stage=this.state.getValue(RoomMeasurementMode,'stage');
  this.panel.getElementById('NormalControls')?.setProperties({display:active?'none':'flex'});
  this.panel.getElementById('MeasurementControls')?.setProperties({display:active?'flex':'none'});
  this.panel.getElementById('Measure')?.setProperties({backgroundColor:active?'#ffe398':'#e5f2f4'});
  this.label('MeasureLabel',active?'寸法測定を終了':'寸法測定');
  this.label('MeasureAddLabel','追加');this.label('MeasureResetLabel','リセット');
  this.label('MeasureHint',stage==='end'?'同じモデルの2点目に触れる':stage==='done'?'追加で次の寸法を測定':'右手で始点に触れる');
  this.label('MeasureCount',`寸法線 ${this.views.size}本 / 実寸 mm`);
 }
 private setMode(active:boolean){
  if(active===this.state.getValue(RoomMeasurementMode,'active'))return;
  this.state.setValue(RoomMeasurementMode,'active',active);this.room.setMeasurementLock(active);
  if(active)this.createProxies();else this.removeProxies();
  this.first=null;this.lastPressed=true;this.state.setValue(RoomMeasurementMode,'stage','ready');
  if(!active){this.live.visible=false;this.state.setValue(RoomMeasurementMode,'hit',false);}
  this.renderUI();
 }
 private beginNext(){this.first=null;this.lastPressed=true;this.state.setValue(RoomMeasurementMode,'stage','ready');this.renderUI();}
 private createProxies(){
  for(const model of this.queries.models.entities){
   const source=model.object3D;if(!source)continue;source.updateWorldMatrix(true,true);
   const root=new Group(),meshes:Mesh[]=[];root.name='Measurement surface';
   // Freeze the visible pose into an owned picking geometry. The BVH queries
   // actual triangles, including holes and skin/morph deformation, not boxes.
   source.traverse(original=>{
    if(!(original instanceof Mesh))return;
    const geometry=new BufferGeometry(),position=original.geometry.getAttribute('position');if(!position)return;
    const points=new Float32Array(position.count*3);
    for(let i=0;i<position.count;i++){original.getVertexPosition(i,this.va);this.va.toArray(points,i*3);}
    geometry.setAttribute('position',new Float32BufferAttribute(points,3));if(original.geometry.index)geometry.setIndex(original.geometry.index.clone());
    geometry.boundsTree=new MeshBVH(geometry,{indirect:true});geometry.computeBoundingBox();geometry.computeBoundingSphere();
    const mesh=new Mesh(geometry,new MeshBasicMaterial({visible:false,side:DoubleSide}));mesh.name=original.name;
    mesh.matrixAutoUpdate=false;mesh.matrix.copy(original.matrixWorld);mesh.raycast=acceleratedRaycast;
    mesh.pointerEventsType={allow:['ray','touch']};this.proxyMeshes.set(mesh,original);meshes.push(mesh);root.add(mesh);
   });
   const entity=this.world.createTransformEntity(root,{persistent:true});entity.addComponent(RayInteractable);entity.addComponent(PokeInteractable);
   root.pointerEventsType={allow:['ray','touch']};this.roots.set(root,model);this.proxies.set(model,{entity,root,meshes});
  }
 }
 private removeProxies(){
  for(const {entity,root,meshes} of this.proxies.values()){
   for(const mesh of meshes){mesh.removeFromParent();mesh.geometry.dispose();for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material])material.dispose();this.proxyMeshes.delete(mesh);}
   this.roots.delete(root);entity.dispose();
  }
  this.proxies.clear();
 }
 private refreshCount(){this.state.setValue(RoomMeasurementMode,'count',this.views.size);this.renderUI();}
 private reset(){this.clearLines();this.beginNext();}
 private clearLines(){for(const [entity,view] of this.views)this.removeLine(entity,view);this.refreshCount();}
 private removeLine(entity:Entity,view:DimensionView){
  // Shared cord/target geometries belong to the manifest, not this placement.
  view.cord.removeFromParent();view.a.removeFromParent();view.b.removeFromParent();
  view.texture.dispose();view.label.material.dispose();entity.dispose();this.views.delete(entity);
 }
 private modelFor(pick:Pick|undefined){
  let object=pick?.object;
  while(object){const entity=this.roots.get(object as Group);if(entity)return entity;object=object.parent??undefined;}
  return undefined;
 }
 private anchor(pick:Pick,model:Entity):Anchor|null{
  if(!(pick.object instanceof Mesh))return null;
  const mesh=this.proxyMeshes.get(pick.object)??pick.object,point=mesh.worldToLocal((pick.pointOnFace??pick.point).clone());
  const anchor:Anchor={model,mesh,point};
  const face=pick.face;
  if(face&&(mesh instanceof SkinnedMesh||mesh.morphTargetInfluences?.length)){
   mesh.getVertexPosition(face.a,this.va);mesh.getVertexPosition(face.b,this.vb);mesh.getVertexPosition(face.c,this.vc);
   const weights=Triangle.getBarycoord(point,this.va,this.vb,this.vc,new Vector3());
   if(weights){anchor.indices=[face.a,face.b,face.c];anchor.weights=weights;}
  }
  return anchor;
 }
 private worldPoint(anchor:Anchor,out:Vector3){
  const {mesh,indices,weights}=anchor;
  if(indices&&weights){mesh.getVertexPosition(indices[0],this.va);mesh.getVertexPosition(indices[1],this.vb);mesh.getVertexPosition(indices[2],this.vc);out.copy(this.va).multiplyScalar(weights.x).addScaledVector(this.vb,weights.y).addScaledVector(this.vc,weights.z);}
  else out.copy(anchor.point);
  return mesh.localToWorld(out);
 }
 private span(object:Group,start:Vector3,end:Vector3){
  this.direction.subVectors(end,start);const length=this.direction.length();object.visible=length>1e-7;
  object.position.copy(start).add(end).multiplyScalar(.5);object.scale.set(1,Math.max(length,1e-7),1);
  if(length>1e-7)object.quaternion.setFromUnitVectors(UP,this.direction.multiplyScalar(1/length));
 }
 private commit(pick:Pick,model:Entity){
  if(this.state.getValue(RoomMeasurementMode,'stage')==='done')return;
  const anchor=this.anchor(pick,model);if(!anchor)return;
  if(!this.first){this.first=anchor;this.state.setValue(RoomMeasurementMode,'stage','end');this.renderUI();return;}
  if(this.first.model!==model){this.label('MeasureHint','同じモデルの2点目に触れる');return;}
  const root=model.object3D!;
  this.worldPoint(this.first,this.a);this.worldPoint(anchor,this.b);
  root.worldToLocal(this.localA.copy(this.a));root.worldToLocal(this.localB.copy(this.b));
  if(this.localA.distanceTo(this.localB)<.00001)return;
  const group=new Group();group.name=`Dimension ${this.views.size+1}`;
  const canvas=document.createElement('canvas');canvas.width=480;canvas.height=120;
  const texture=new CanvasTexture(canvas),label=new Sprite(new SpriteMaterial({map:texture,depthTest:false,depthWrite:false,transparent:true}));
  label.name='Dimension mm';label.renderOrder=1204;label.scale.set(.12,.03,1);
  const cord=dimensionCord.clone(true),a=dimensionHit.clone(true),b=dimensionHit.clone(true);group.add(cord,a,b,label);
  const entity=this.world.createTransformEntity(group,{persistent:true});
  entity.addComponent(RoomDimension,{model,start:this.localA.toArray(),end:this.localB.toArray(),millimetres:this.localA.distanceTo(this.localB)*1000});
  this.views.set(entity,{start:this.first,end:anchor,cord,a,b,label,canvas,texture,text:''});
  this.first=null;this.state.setValue(RoomMeasurementMode,'stage','done');this.refreshCount();
 }
 private updateDimensions(){
  for(const [entity,view] of this.views){
   const root=view.start.model.object3D;if(!root)continue;
   this.worldPoint(view.start,this.a);this.worldPoint(view.end,this.b);
   this.span(view.cord,this.a,this.b);view.a.position.copy(this.a);view.b.position.copy(this.b);
   view.label.position.copy(this.a).add(this.b).multiplyScalar(.5);view.label.position.y+=.024;
   root.worldToLocal(this.localA.copy(this.a));root.worldToLocal(this.localB.copy(this.b));
   const mm=this.localA.distanceTo(this.localB)*1000;
   entity.setValue(RoomDimension,'millimetres',mm);entity.getVectorView(RoomDimension,'start').set(this.localA.toArray(this.cachedA));entity.getVectorView(RoomDimension,'end').set(this.localB.toArray(this.cachedB));
   if(this.frame%15!==0&&view.text)continue;
   const text=`${mm.toLocaleString('ja-JP',{minimumFractionDigits:1,maximumFractionDigits:1})} mm`;
   if(view.text===text)continue;view.text=text;
   const ctx=view.canvas.getContext('2d')!;ctx.clearRect(0,0,480,120);ctx.fillStyle='#142128';ctx.beginPath();ctx.roundRect(1,1,478,118,18);ctx.fill();ctx.strokeStyle='#ffd800';ctx.lineWidth=4;ctx.stroke();ctx.fillStyle='#ffffff';ctx.font='600 54px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,240,60,460);view.texture.needsUpdate=true;
  }
 }
 private cachedA=[0,0,0];private cachedB=[0,0,0];
 update(){
  this.frame++;this.updateDimensions();
  if(!this.state.getValue(RoomMeasurementMode,'active'))return;
  const source=this.input.xr.getPrimaryInputSource('right');
  const xr=this.world.renderer.xr,space=xr.getReferenceSpace(),frame=xr.getFrame(),tip=source?.hand?.get('index-finger-tip');
  if(!source||(source.hand&&(!tip||!space||!frame?.getJointPose?.(tip,space)))){this.live.visible=false;this.state.setValue(RoomMeasurementMode,'hit',false);this.lastPressed=true;return;}
  const mp=this.input.xr.multiPointers.right,ray=mp.getPointer('ray'),touch=mp.getPointer('touch');
  const touchPick=touch.getIntersection(),rayPick=ray.getIntersection();
  if(source.hand)this.player.indexTipSpaces.right.getWorldPosition(this.origin);else this.player.raySpaces.right.getWorldPosition(this.origin);
  let contact:Pick|undefined;
  if(source.hand&&this.modelFor(touchPick)&&touchPick?.object instanceof Mesh){
   const mesh=touchPick.object,bvh=mesh.geometry.boundsTree;
   this.localA.copy(this.origin);mesh.worldToLocal(this.localA);
   if(bvh?.closestPointToPoint(this.localA,this.nearest)){
    this.contact.object=mesh;this.contact.point.copy(this.nearest.point);mesh.localToWorld(this.contact.point);
    const distance=this.origin.distanceTo(this.contact.point);
    this.touchLatched=distance<=(this.touchLatched ? .018 : .004);
    const index=mesh.geometry.index,offset=this.nearest.faceIndex*3,face=this.contact.face!;
    face.a=index?index.getX(offset):offset;face.b=index?index.getX(offset+1):offset+1;face.c=index?index.getX(offset+2):offset+2;
    if(this.touchLatched)contact=this.contact;
   }else this.touchLatched=false;
  }else this.touchLatched=false;
  const pick=contact??rayPick,model=this.modelFor(pick);
  const pressed=!!contact||(ray.getEnabled()&&!!this.modelFor(rayPick)&&ray.getButtonsDown().has(0));
  this.live.visible=true;
  this.state.setValue(RoomMeasurementMode,'hit',!!model);
  if(model&&pick){this.end.copy(pick.pointOnFace??pick.point);this.target.position.copy(this.end);this.glow.position.copy(this.end);this.target.visible=this.glow.visible=true;this.state.getVectorView(RoomMeasurementMode,'hitPoint').set(this.end.toArray(this.cachedA));}
  else {this.player.raySpaces.right.getWorldDirection(this.direction).negate();this.end.copy(this.origin).addScaledVector(this.direction,2);this.target.visible=this.glow.visible=false;}
  this.span(this.laser,this.origin,this.end);
  if(this.first)this.worldPoint(this.first,this.a);else this.a.copy(this.origin);
  this.span(this.cord,this.a,this.end);
  if(pressed&&!this.lastPressed&&model&&pick)this.commit(pick,model);
  this.lastPressed=pressed;
 }
}
