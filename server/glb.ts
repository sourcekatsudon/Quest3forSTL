import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {MeshoptDecoder} from 'meshoptimizer';
import draco from 'draco3dgltf';
import {ApiError,limits,MAX_TRIANGLES} from './validation.js';

export function glbJson(bytes:Uint8Array):Record<string,any>{
 if(bytes.length<20||bytes.length>limits.maxFileBytes)throw new ApiError(413,'GLBの容量を確認してください。');
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 if(view.getUint32(0,true)!==0x46546c67||view.getUint32(4,true)!==2||view.getUint32(8,true)!==bytes.length||view.getUint32(16,true)!==0x4e4f534a)throw new ApiError(422,'有効なGLB 2.0ファイルを選択してください。');
 const size=view.getUint32(12,true);if(size>bytes.length-20)throw new ApiError(422,'GLBデータが壊れています。');
 let json;try{json=JSON.parse(new TextDecoder().decode(bytes.subarray(20,20+size)));}catch{throw new ApiError(422,'GLBの構造が壊れています。');}
 for(const resource of [...(json.buffers??[]),...(json.images??[])])if(resource.uri&&!resource.uri.startsWith('data:'))throw new ApiError(422,'画像・形状をすべて埋め込んだGLBを選択してください。');
 if((json.buffers??[]).reduce((s:number,b:any)=>s+(b.byteLength??0),0)>256*1024*1024||(json.accessors??[]).some((a:any)=>a.count>3_000_000))throw new ApiError(413,'GLBの展開後の容量が大きすぎます。');
 if(json.extensionsUsed?.includes('EXT_mesh_gpu_instancing'))throw new ApiError(422,'インスタンスを通常のメッシュに変換したGLBを書き出してください。');
 if(json.extensionsUsed?.includes('KHR_texture_basisu'))throw new ApiError(422,'GLBの画像をPNG・JPEGにして書き出してください。');
 return json;
}
let decoder:Promise<unknown>|undefined;
export async function inspectGlb(bytes:Uint8Array){
 glbJson(bytes);
 try{
  decoder??=draco.createDecoderModule();await MeshoptDecoder.ready;
  const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'draco3d.decoder':await decoder,'meshopt.decoder':MeshoptDecoder});
  const document=await io.readBinary(bytes),root=document.getRoot();
  const scene=root.getDefaultScene()??root.listScenes()[0];if(!scene)throw new Error('No scene');
  let triangles=0;const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  scene.traverse(node=>{
   const matrix=node.getWorldMatrix();
   for(const primitive of node.getMesh()?.listPrimitives()??[]){
    const positions=primitive.getAttribute('POSITION');if(!positions)continue;
    const count=primitive.getIndices()?.getCount()??positions.getCount();
    const mode=primitive.getMode();if(mode!==4&&mode!==5&&mode!==6)continue;
    triangles+=mode===4?count/3:count-2;
    if(triangles>MAX_TRIANGLES)throw new ApiError(413,'GLBは100万三角形以下にしてください。');
    const p:number[]=[];for(let i=0;i<positions.getCount();i++){
     positions.getElement(i,p);
     for(let a=0;a<3;a++){
      const value=matrix[a]*p[0]+matrix[4+a]*p[1]+matrix[8+a]*p[2]+matrix[12+a];
      if(!Number.isFinite(value)||Math.abs(value)>1e6)throw new Error('Invalid GLB position');
      min[a]=Math.min(min[a],value);max[a]=Math.max(max[a],value);
     }
    }
   }
  });
  if(!triangles||Math.max(...max.map((v,a)=>v-min[a]))<=0)throw new Error('Empty GLB');
  // GLB is Y-up, metres. Shared CAD metadata uses width X, depth Z, height Y, mm.
  return{triangles,dimensions:{width:(max[0]-min[0])*1000,depth:(max[2]-min[2])*1000,height:(max[1]-min[1])*1000}};
 }catch(error){if(error instanceof ApiError)throw error;throw new ApiError(422,'GLBを読み込めませんでした。形状と埋め込み画像を確認してください。');}
}
