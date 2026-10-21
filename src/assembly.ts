import { Box3, BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial, Vector3 } from '@iwsdk/core';
import type { ParsedModel } from './model';

export interface ExplodedPart { mesh: Mesh; offset: Vector3 }
/** Display-only radial layout. Positions in the parsed source geometry are never changed. */
export function createAssembly(parsed: ParsedModel, material: MeshStandardMaterial): { group: Group; parts: ExplodedPart[] } {
  const group=new Group();const parts:ExplodedPart[]=[];
  const source=parsed.geometry.getAttribute('position');
  const radius=parsed.geometry.boundingSphere?.radius??.1;
  for(const [index,part] of (parsed.parts??[]).entries()){
    const positions=new Float32Array(part.count*9);
    for(let i=0;i<part.count*3;i++){
      const vertex=part.start*3+i;positions[i*3]=source.getX(vertex);positions[i*3+1]=source.getY(vertex);positions[i*3+2]=source.getZ(vertex);
    }
    const geometry=new BufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute(positions,3));
    geometry.computeVertexNormals();geometry.computeBoundingBox();
    const center=geometry.boundingBox!.getCenter(new Vector3());
    let offset:Vector3;
    if(center.length()>radius*.025){offset=center.clone().multiplyScalar(2).addScaledVector(center.clone().normalize(),radius*.55);}
    else{
      const n=parsed.parts!.length,y=1-2*(index+.5)/n,angle=index*2.399963229728653;
      offset=new Vector3(Math.cos(angle)*Math.sqrt(1-y*y),y,Math.sin(angle)*Math.sqrt(1-y*y)).multiplyScalar(radius*1.25);
    }
    const mesh=new Mesh(geometry,material);mesh.name=part.name;mesh.userData.assemblyPath=part.path;
    group.add(mesh);parts.push({mesh,offset});
  }
  return {group,parts};
}

export function applyExplosion(parts: ExplodedPart[], fraction: number): void {
  const amount=Math.max(0,Math.min(1,Number.isFinite(fraction)?fraction:0));
  for(const part of parts)part.mesh.position.copy(part.offset).multiplyScalar(amount);
}

export function assemblyRadius(group:Group):number{
  return new Box3().setFromObject(group).getSize(new Vector3()).length()/2;
}
