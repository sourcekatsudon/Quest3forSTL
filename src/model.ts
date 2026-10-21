import { BufferGeometry, Float32BufferAttribute, AssetManager, CacheManager, Group, Mesh, Box3, Vector3, Material, Object3D } from '@iwsdk/core';
import { parseSTLData, type Dimensions, type STLData } from './stl-parser';
export type { Dimensions } from './stl-parser';
import type { AssemblyPart } from '../shared/models';
export type { AssemblyPart } from '../shared/models';
export interface ParsedModel { geometry: BufferGeometry; dimensions: Dimensions; triangles: number; parts?: AssemblyPart[]; scene?: Group }

export async function loadGLB(buffer:ArrayBuffer):Promise<ParsedModel>{
 const url=URL.createObjectURL(new Blob([buffer],{type:'model/gltf-binary'}));
 try{
  const gltf=await AssetManager.loadGLTF(url);
  const source=gltf.scene;source.updateMatrixWorld(true);
  const scene=new Group();
  source.traverse(child=>{if(!(child instanceof Mesh))return;const geometry=child.geometry.clone();const p=geometry.getAttribute('position'),v=new Vector3();for(let i=0;i<p.count;i++){child.getVertexPosition(i,v).applyMatrix4(child.matrixWorld);p.setXYZ(i,v.x,v.y,v.z);}geometry.computeVertexNormals();geometry.computeBoundingBox();geometry.computeBoundingSphere();scene.add(new Mesh(geometry,child.material));});
  source.traverse(child=>{if(child instanceof Mesh)child.geometry.dispose();});
  const box=new Box3().setFromObject(scene),center=box.getCenter(new Vector3()),size=box.getSize(new Vector3());
  scene.position.sub(center);scene.updateMatrixWorld(true);
  const positions:number[]=[];const point=new Vector3();let triangles=0;
  scene.traverse(child=>{if(!(child instanceof Mesh))return;
   const geometry=child.geometry,p=geometry.getAttribute('position');if(!p)return;
   const index=geometry.index,count=index?.count??p.count;triangles+=count/3;
   if(triangles>1_000_000)throw new Error('GLBは100万三角形以下にしてください。');
   for(let i=0;i<count;i++){point.fromBufferAttribute(p,index?index.getX(i):i).applyMatrix4(child.matrixWorld);positions.push(point.x,point.y,point.z);}
  });
  if(!triangles)throw new Error('GLBに表示できる形状がありません。');
  const geometry=new BufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute(positions,3));geometry.computeVertexNormals();geometry.computeBoundingBox();geometry.computeBoundingSphere();
  return{geometry,scene,triangles,dimensions:{width:size.x*1000,depth:size.z*1000,height:size.y*1000}};
 }finally{CacheManager.deleteAsset(url);URL.revokeObjectURL(url);}
}

/** Instances own their render resources, so deleting one never breaks another. */
export function cloneModelScene(source:Group):Group{
 const clone=source.clone(true);clone.traverse(child=>{if(child instanceof Mesh){child.geometry=child.geometry.clone();child.material=Array.isArray(child.material)?child.material.map((m:Material)=>m.clone()):child.material.clone();}});return clone;
}
export function disposeParsed(model:ParsedModel){
 model.geometry.dispose();model.scene?.traverse(child=>{if(child instanceof Mesh){child.geometry.dispose();for(const material of Array.isArray(child.material)?child.material:[child.material]){for(const value of Object.values(material))if(value&&typeof value==='object'&&'isTexture' in value)(value as unknown as {dispose():void}).dispose();material.dispose();}}});
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


