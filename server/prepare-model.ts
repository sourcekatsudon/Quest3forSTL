import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AssemblyData } from '../shared/models.js';
import { optimizeStl, writeBinaryStl, type OptimizedStl } from './optimize-stl.js';
import { ApiError, inspectStl, limits, MAX_TRIANGLES, positiveLimit } from './validation.js';
import {inspectGlb} from './glb.js';

let importer: ReturnType<typeof import('occt-import-js')['default']> | undefined;
async function stepImporter() {
  if (!importer) importer = (async () => {
    const { default: initialize } = await import('occt-import-js');
    const wasmBinary = await readFile(join(process.cwd(),'node_modules/occt-import-js/dist/occt-import-js.wasm'));
    return initialize({wasmBinary, print:()=>{}, printErr:()=>{}});
  })().catch(error=>{importer=undefined;throw error;});
  return importer;
}

export function validateStep(bytes: Uint8Array) {
  if (!bytes.length || bytes.length > limits.maxFileBytes) throw new ApiError(413,'STEPの容量上限を超えています。');
  const header=new TextDecoder().decode(bytes.subarray(0,4096));
  const tail=new TextDecoder().decode(bytes.subarray(Math.max(0,bytes.length-4096)));
  if(!/^\s*ISO-10303-21\s*;/i.test(header)||!/END-ISO-10303-21\s*;/i.test(tail)) throw new ApiError(422,'有効なSTEPファイル（.step / .stp）を選択してください。');
}

export interface PreparedModel { source: ReturnType<typeof inspectStl>; optimized: OptimizedStl; assembly?: AssemblyData; format:'stl'|'step'|'glb' }
export async function prepareModel(bytes: Uint8Array, name: string): Promise<PreparedModel> {
  if(/\.glb$/i.test(name)){
    const source=await inspectGlb(bytes);
    return {source,format:'glb',optimized:{bytes,metadata:{version:1,triangles:source.triangles,size:bytes.length,targetTriangles:source.triangles,estimatedErrorMm:0,errorLimitMm:0,status:'unchanged'}}};
  }
  if (!/\.(step|stp)$/i.test(name)) return {source:inspectStl(bytes),optimized:await optimizeStl(bytes),format:'stl'};
  validateStep(bytes);
  const occt=await stepImporter();
  let result: ReturnType<typeof occt.ReadStepFile>;
  try { result=occt.ReadStepFile(bytes,{linearUnit:'millimeter',linearDeflectionType:'absolute_value',linearDeflection:.15,angularDeflection:.35}); }
  catch { throw new ApiError(422,'STEPを変換できませんでした。形状を確認して再エクスポートしてください。'); }
  if(!result.success||!result.meshes?.length) throw new ApiError(422,'STEPに表示できる部品がありません。外部参照を含めて書き出してください。');
  if(result.meshes.length>1000) throw new ApiError(413,'STEPは1000部品以下に分けてください。');
  const sourceTriangles=result.meshes.reduce((n,m)=>n+m.index.array.length/3,0);
  if(sourceTriangles>MAX_TRIANGLES) throw new ApiError(413,'STEPの変換結果が100万面を超えました。アセンブリを分けてください。');
  const paths=new Map<number,string[]>();
  function visit(node:typeof result.root,parent:string[],depth=0){
    if(depth>64)throw new ApiError(422,'STEPの部品階層が深すぎます。');
    const path=node.name?[...parent,node.name.slice(0,180)]:parent;
    for(const index of node.meshes??[])paths.set(index,path);
    for(const child of node.children??[])visit(child,path,depth+1);
  }
  visit(result.root,[]);
  const target=positiveLimit(process.env.STL_DISPLAY_TRIANGLES,100_000,250_000);
  const assembly:AssemblyData={version:1,parts:[]};
  const outputs:Uint8Array[]=[];
  let start=0,estimatedErrorMm=0,errorLimitMm=0,failed=false;
  const sourceMin=[Infinity,Infinity,Infinity],sourceMax=[-Infinity,-Infinity,-Infinity];
  for(const [index,mesh] of result.meshes.entries()){
    if(!mesh.index.array.length)continue;
    const positions=Float32Array.from(mesh.attributes.position.array);
    const indices=Uint32Array.from(mesh.index.array);
    if(indices.length%3||indices.some(i=>i*3+2>=positions.length))throw new ApiError(422,'STEPの部品形状が壊れています。');
    const part=writeBinaryStl(positions,indices);
    inspectStl(part);
    for(const vertex of indices)for(let axis=0;axis<3;axis++){
      sourceMin[axis]=Math.min(sourceMin[axis],positions[vertex*3+axis]);sourceMax[axis]=Math.max(sourceMax[axis],positions[vertex*3+axis]);
    }
    // Simplify parts independently: merging first would erase assembly boundaries.
    const optimized=await optimizeStl(part,{targetTriangles:Math.max(12,Math.floor(target*indices.length/3/sourceTriangles))});
    estimatedErrorMm=Math.max(estimatedErrorMm,optimized.metadata.estimatedErrorMm);
    errorLimitMm=Math.max(errorLimitMm,optimized.metadata.errorLimitMm);
    failed ||= optimized.metadata.status==='failed';
    const count=optimized.metadata.triangles;
    assembly.parts.push({name:(mesh.name||paths.get(index)?.at(-1)||`部品 ${index+1}`).slice(0,180),path:paths.get(index)??[],start,count});
    outputs.push(optimized.bytes);start+=count;
  }
  if(!start)throw new ApiError(422,'STEPに表示できる形状がありません。');
  const display=new Uint8Array(84+start*50);
  display.set(new TextEncoder().encode('STEP assembly display v1'));
  new DataView(display.buffer).setUint32(80,start,true);
  let offset=84;for(const part of outputs){display.set(part.subarray(84),offset);offset+=part.length-84;}
  inspectStl(display);
  return {format:'step',assembly,source:{triangles:sourceTriangles,dimensions:{width:sourceMax[0]-sourceMin[0],depth:sourceMax[1]-sourceMin[1],height:sourceMax[2]-sourceMin[2]}},optimized:{bytes:display,metadata:{version:1,triangles:start,size:display.length,targetTriangles:target,estimatedErrorMm,errorLimitMm,status:failed?'failed':start===sourceTriangles?'unchanged':start<=target?'simplified':'quality-limited'}}};
}
