import {writeBinaryStl} from './optimize-stl.js';
/** Closed CAD-Z-up sphere; duplicated STL corners emulate generated high-poly meshes. */
export function sphereStl(latitude=64,longitude=128):Uint8Array{
 const positions=new Float32Array((latitude+1)*(longitude+1)*3);
 for(let y=0;y<=latitude;y++)for(let x=0;x<=longitude;x++){
  const angle=Math.PI*y/latitude,phi=Math.PI*2*(x===longitude?0:x)/longitude;
  const i=(y*(longitude+1)+x)*3;
  positions[i]=y===0||y===latitude?0:100*Math.sin(angle)*Math.cos(phi);
  positions[i+1]=y===0||y===latitude?0:100*Math.sin(angle)*Math.sin(phi);
  positions[i+2]=100*Math.cos(angle);
 }
 const indices=new Uint32Array((latitude-1)*longitude*6);let offset=0;
 for(let y=0;y<latitude;y++)for(let x=0;x<longitude;x++){
  const a=y*(longitude+1)+x,b=a+1,c=a+longitude+1,d=c+1;
  if(y!==0){indices[offset++]=a;indices[offset++]=b;indices[offset++]=c;}
  if(y!==latitude-1){indices[offset++]=b;indices[offset++]=d;indices[offset++]=c;}
 }
 return writeBinaryStl(positions,indices);
}
