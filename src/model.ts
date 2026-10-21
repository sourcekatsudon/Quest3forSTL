import { BufferGeometry, Float32BufferAttribute, AssetManager, CacheManager, Group, Mesh, Box3, Vector3, Material, Object3D, SkinnedMesh, Bone, AnimationClip } from '@iwsdk/core';
import { parseSTLData, type Dimensions, type STLData } from './stl-parser';
export type { Dimensions } from './stl-parser';
import type { AssemblyPart } from '../shared/models';
export type { AssemblyPart } from '../shared/models';
export interface ParsedModel { geometry: BufferGeometry; dimensions: Dimensions; triangles: number; parts?: AssemblyPart[]; scene?: Group; animations?: AnimationClip[] }

export async function loadGLB(buffer:ArrayBuffer):Promise<ParsedModel>{
 const url=URL.createObjectURL(new Blob([buffer],{type:'model/gltf-binary'}));
 try{
  const gltf=await AssetManager.loadGLTF(url);
  const source=gltf.scene;source.updateMatrixWorld(true);
  source.traverse(child=>{if(child instanceof SkinnedMesh)child.frustumCulled=false;});
  // Preserve bones, morph targets, node names and animation bindings. Center via
  // a separate parent so animation tracks never overwrite the user's placement.
  const box=new Box3().setFromObject(source,true),center=box.getCenter(new Vector3()),size=box.getSize(new Vector3());
  const scene=new Group(),offset=new Group();offset.position.copy(center).negate();
  scene.add(offset);offset.add(source);scene.animations=gltf.animations;scene.updateMatrixWorld(true);
  const positions:number[]=[];const point=new Vector3();let triangles=0;
  scene.traverse(child=>{if(!(child instanceof Mesh))return;
   const geometry=child.geometry,p=geometry.getAttribute('position');if(!p)return;
   const index=geometry.index,count=index?.count??p.count;triangles+=count/3;
   if(triangles>1_000_000)throw new Error('GLBは100万三角形以下にしてください。');
   for(let i=0;i<count;i++){child.getVertexPosition(index?index.getX(i):i,point).applyMatrix4(child.matrixWorld);positions.push(point.x,point.y,point.z);}
  });
  if(!triangles)throw new Error('GLBに表示できる形状がありません。');
  const geometry=new BufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute(positions,3));geometry.computeVertexNormals();geometry.computeBoundingBox();geometry.computeBoundingSphere();
  return{geometry,scene,animations:gltf.animations,triangles,dimensions:{width:size.x*1000,depth:size.z*1000,height:size.y*1000}};
 }finally{CacheManager.deleteAsset(url);URL.revokeObjectURL(url);}
}

/** Instances own their render resources, so deleting one never breaks another. */
export function cloneModelScene(source:Group):Group{
 const clone=source.clone(true),copies=new Map<Object3D,Object3D>(),ids=new Map<string,string>();
 const pair=(original:Object3D,copy:Object3D)=>{copies.set(original,copy);ids.set(original.uuid,copy.uuid);original.children.forEach((child,i)=>pair(child,copy.children[i]));};pair(source,clone);
 for(const [original,copy] of copies){
  if(original instanceof Mesh&&copy instanceof Mesh){
   copy.geometry=original.geometry.clone();copy.material=Array.isArray(original.material)?original.material.map((m:Material)=>m.clone()):original.material.clone();
   if(original instanceof SkinnedMesh&&copy instanceof SkinnedMesh){
    const skeleton=original.skeleton.clone();
    skeleton.bones=original.skeleton.bones.map(bone=>{const mapped=copies.get(bone);if(!(mapped instanceof Bone))throw new Error('GLBの骨格がシーンに含まれていません。');return mapped;});
    copy.bind(skeleton,original.bindMatrix);
   }
  }
 }
 clone.animations=source.animations.map(clip=>{const result=clip.clone();for(const track of result.tracks){const dot=track.name.indexOf('.'),node=track.name.slice(0,dot),id=ids.get(node);if(id)track.name=id+track.name.slice(dot);}return result;});
 return clone;
}
export function disposeModelScene(scene:Object3D,disposeTextures=false){
 scene.traverse(child=>{if(child instanceof Mesh){child.geometry.dispose();if(child instanceof SkinnedMesh)child.skeleton.dispose();for(const material of Array.isArray(child.material)?child.material:[child.material]){if(disposeTextures)for(const value of Object.values(material))if(value&&typeof value==='object'&&'isTexture' in value)(value as unknown as {dispose():void}).dispose();material.dispose();}}});
}
export function disposeParsed(model:ParsedModel){
 model.geometry.dispose();if(model.scene)disposeModelScene(model.scene,true);
}

function toModel(data: STLData): ParsedModel {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(data.positions, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return { geometry, dimensions: data.dimensions, triangles: data.triangles };
}
export function parseSTL(buffer: ArrayBuffer): ParsedModel { return toModel(parseSTLData(buffer)); }
export async function loadSTL(buffer: ArrayBuffer): Promise<ParsedModel> {
  if (typeof Worker === 'undefined') return parseSTL(buffer);
  const worker = new Worker(new URL('./stl-worker.ts', import.meta.url), { type: 'module' });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { worker.terminate(); reject(new Error('読み込みに時間がかかっています。モデルを簡略化してください。')); }, 30_000);
    const finish = () => { clearTimeout(timer); worker.terminate(); };
    worker.onmessage = (event: MessageEvent<STLData & { ok: boolean; error?: string }>) => {
      finish();
      if (event.data.ok) resolve(toModel(event.data)); else reject(new Error(event.data.error));
    };
    worker.onerror = () => { finish(); reject(new Error('STLを読み込めませんでした。もう一度お試しください。')); };
    worker.postMessage(buffer, [buffer]);
  });
}


