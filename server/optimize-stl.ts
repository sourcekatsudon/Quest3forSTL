import { MeshoptSimplifier } from 'meshoptimizer';
import type { ModelRecord } from '../shared/models.js';
import { inspectStl, positiveLimit } from './validation.js';

export interface OptimizedStl { bytes: Uint8Array; metadata: NonNullable<ModelRecord['optimization']> }
export interface OptimizationOptions { targetTriangles?: number; maxErrorMm?: number; relativeError?: number }
const positive = (value: string | undefined, fallback: number, maximum: number) => {
 const n=Number(value);return Number.isFinite(n)&&n>0?Math.min(n,maximum):fallback;
};

/** Server-only, error-bounded display derivative. Never changes the original upload. */
export async function optimizeStl(bytes: Uint8Array, options: OptimizationOptions = {}): Promise<OptimizedStl> {
 const source=inspectStl(bytes);
 const target=Math.max(1,Math.floor(options.targetTriangles??positiveLimit(process.env.STL_DISPLAY_TRIANGLES,100_000,250_000)));
 const extent=Math.max(...Object.values(source.dimensions));
 const errorLimitMm=Math.min(options.maxErrorMm??positive(process.env.STL_DISPLAY_MAX_ERROR_MM,.25,5),extent*(options.relativeError??positive(process.env.STL_DISPLAY_RELATIVE_ERROR,.003,.02)));
 const original:OptimizedStl={bytes,metadata:{version:1,triangles:source.triangles,size:bytes.byteLength,targetTriangles:target,estimatedErrorMm:0,errorLimitMm,status:'unchanged'}};
 if(source.triangles<=target)return original;
 try {
  await MeshoptSimplifier.ready;
  const raw=readPositions(bytes,source.triangles);
  // STL repeats every triangle's vertices. Exact welding is essential for topology-aware reduction.
  const remap=MeshoptSimplifier.generatePositionRemap(raw,3);
  const dense=new Uint32Array(remap.length);dense.fill(0xffffffff);
  const positionsBuffer=new Float32Array(raw.length);
  const indices=new Uint32Array(remap.length);
  let count=0;
  for(let i=0;i<remap.length;i++){
   const representative=remap[i];
   if(dense[representative]===0xffffffff){
    dense[representative]=count;
    positionsBuffer[count*3]=raw[i*3];positionsBuffer[count*3+1]=raw[i*3+1];positionsBuffer[count*3+2]=raw[i*3+2];count++;
   }
   indices[i]=dense[representative];
  }
  const positions=positionsBuffer.subarray(0,count*3);
  const locks=new Uint8Array(count);
  // Retain all six bounding-box extrema, so CAD dimensions/centering/real scale stay intact.
  for(let axis=0;axis<3;axis++){
   let low=0,high=0;
   for(let i=1;i<count;i++){if(positions[i*3+axis]<positions[low*3+axis])low=i;if(positions[i*3+axis]>positions[high*3+axis])high=i;}
   locks[low]=1;locks[high]=1;
  }
  const [simplified,error]=MeshoptSimplifier.simplifyWithAttributes(indices,positions,3,new Float32Array(0),0,[],locks,target*3,errorLimitMm,['LockBorder','PreserveFolds','ErrorAbsolute']);
  if(!Number.isFinite(error)||error>errorLimitMm*1.0001||simplified.length<3||simplified.length>=indices.length){
   return {...original,metadata:{...original.metadata,status:'quality-limited'}};
  }
  const output=writeBinaryStl(positions,simplified);
  const checked=inspectStl(output);
  for(const axis of ['width','depth','height'] as const){
   if(Math.abs(checked.dimensions[axis]-source.dimensions[axis])>Math.max(.00001,source.dimensions[axis]*.000001))throw new Error('Bounding dimensions changed');
  }
  if(output.byteLength>=bytes.byteLength)return {...original,metadata:{...original.metadata,status:'quality-limited'}};
  return {bytes:output,metadata:{...original.metadata,triangles:simplified.length/3,size:output.byteLength,estimatedErrorMm:error,status:simplified.length/3<=target?'simplified':'quality-limited'}};
 }catch(error){
  console.error('Display optimization failed:',error instanceof Error?error.message:'Unknown simplifier error');
  return {...original,metadata:{...original.metadata,status:'failed'}};
 }
}

function readPositions(bytes:Uint8Array,triangles:number):Float32Array{
 const result=new Float32Array(triangles*9);
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 if(bytes.length===84+triangles*50&&view.getUint32(80,true)===triangles){
  for(let t=0;t<triangles;t++)for(let c=0;c<9;c++)result[t*9+c]=view.getFloat32(96+t*50+c*4,true);
 }else{
  const text=new TextDecoder().decode(bytes);
  const vertex=/\bvertex\s+([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s+([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s+([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/gi;
  let match:RegExpExecArray|null;let offset=0;
  while((match=vertex.exec(text))){result[offset++]=Number(match[1]);result[offset++]=Number(match[2]);result[offset++]=Number(match[3]);}
 }
 return result;
}
export function writeBinaryStl(positions:Float32Array,indices:Uint32Array):Uint8Array{
 const bytes=new Uint8Array(84+indices.length/3*50);bytes.set(new TextEncoder().encode('STL display mesh v1'));
 const view=new DataView(bytes.buffer);view.setUint32(80,indices.length/3,true);
 for(let t=0;t<indices.length/3;t++){
  const a=indices[t*3]*3,b=indices[t*3+1]*3,c=indices[t*3+2]*3;
  const ux=positions[b]-positions[a],uy=positions[b+1]-positions[a+1],uz=positions[b+2]-positions[a+2];
  const vx=positions[c]-positions[a],vy=positions[c+1]-positions[a+1],vz=positions[c+2]-positions[a+2];
  const nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;const length=Math.hypot(nx,ny,nz)||1;
  const start=84+t*50;[nx/length,ny/length,nz/length].forEach((v,i)=>view.setFloat32(start+i*4,v,true));
  for(let corner=0;corner<3;corner++)for(let axis=0;axis<3;axis++)view.setFloat32(start+12+corner*12+axis*4,positions[indices[t*3+corner]*3+axis],true);
 }
 return bytes;
}
