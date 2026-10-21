import { Box3, BufferGeometry, Float32BufferAttribute, Group, Matrix4, Mesh, MeshStandardMaterial, Object3D, SkinnedMesh, Vector3 } from '@iwsdk/core';
import type { ParsedModel } from './model';

export interface ExplodedPart { mesh: Mesh; anchor: Object3D; offset: Vector3; generated: boolean }
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
    group.add(mesh);parts.push({mesh,anchor:mesh,offset,generated:true});
  }
  return {group,parts};
}

export function applyExplosion(parts: ExplodedPart[], fraction: number): void {
  const amount=Math.max(0,Math.min(1,Number.isFinite(fraction)?fraction:0));
  for(const part of parts)part.anchor.position.copy(part.offset).multiplyScalar(amount);
}

/** Add translation-only parents, leaving original GLB nodes, materials and
 * animation tracks intact. A skinned rig cannot be split into rigid parts. */
export function createSceneAssembly(scene:Group):ExplodedPart[]{
 const meshes:Mesh[]=[];let skinned=false;
 scene.traverse(node=>{
  if(node instanceof SkinnedMesh)skinned=true;
  if(!(node instanceof Mesh))return;
  for(let parent=node.parent;parent&&parent!==scene;parent=parent.parent)if(parent instanceof Mesh)return;
  meshes.push(node);
 });
 if(skinned||meshes.length<2||meshes.length>1000){scene.userData.explosionReason=skinned?'スキン付きGLBは爆発図に非対応':meshes.length<2?'GLBが1メッシュのため分離できません':'GLBの部品数が多すぎます';return [];}
 scene.updateWorldMatrix(true,true);
 const bounds=modelBounds(scene),center=bounds.getCenter(new Vector3()),radius=bounds.getSize(new Vector3()).length()/2,parts:ExplodedPart[]=[];
 const inverse=new Matrix4().copy(scene.matrixWorld).invert();
 for(const [index,mesh] of meshes.entries()){
  const parent=mesh.parent!;
  const partCenter=new Box3().setFromObject(mesh,true).applyMatrix4(inverse).getCenter(new Vector3()).sub(center);
  let offset:Vector3;
  if(partCenter.length()>radius*.025)offset=partCenter.clone().multiplyScalar(2).addScaledVector(partCenter.clone().normalize(),radius*.55);
  else{const y=1-2*(index+.5)/meshes.length,a=index*2.399963229728653;offset=new Vector3(Math.cos(a)*Math.sqrt(1-y*y),y,Math.sin(a)*Math.sqrt(1-y*y)).multiplyScalar(radius*1.25);}
  const origin=scene.localToWorld(new Vector3()),destination=scene.localToWorld(offset.clone());
  offset.copy(parent.worldToLocal(destination)).sub(parent.worldToLocal(origin));
  const anchor=new Group();anchor.name=`Explosion offset ${index+1}`;
  const childIndex=parent.children.indexOf(mesh);parent.add(anchor);anchor.add(mesh);
  parent.children.splice(parent.children.indexOf(anchor),1);parent.children.splice(childIndex,0,anchor);
  parts.push({mesh,anchor,offset,generated:false});
 }
 return parts;
}

/** Bounds in the model's coordinates, including nested/rotated GLB nodes. */
export function modelBounds(root:Object3D,target=new Box3()):Box3{
 root.updateWorldMatrix(true,true);target.makeEmpty();
 const inverse=new Matrix4().copy(root.matrixWorld).invert(),matrix=new Matrix4(),box=new Box3();
 root.traverse(node=>{if(!(node instanceof Mesh))return;if(!node.geometry.boundingBox)node.geometry.computeBoundingBox();if(!node.geometry.boundingBox)return;matrix.multiplyMatrices(inverse,node.matrixWorld);target.union(box.copy(node.geometry.boundingBox).applyMatrix4(matrix));});
 return target;
}

export function disposeAssembly(parts:ExplodedPart[]){for(const part of parts)if(part.generated)part.mesh.geometry.dispose();}

export function assemblyRadius(group:Group):number{
  return new Box3().setFromObject(group).getSize(new Vector3()).length()/2;
}
