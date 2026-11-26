import {expect,it} from 'vitest';
import {AnimationClip,Box3,BoxGeometry,BufferGeometry,Float32BufferAttribute,Group,Mesh,MeshStandardMaterial,SkinnedMesh,VectorKeyframeTrack,Vector3} from '@iwsdk/core';
import {applyExplosion,applyRoomExplosion,createAssembly,createSceneAssembly,modelBounds} from '../src/assembly';
import {ModelPlayback} from '../src/playback';
it('GLB parts separate in rotated/scaled parent coordinates, preserve materials and return exactly to their native hierarchy pose',()=>{
 const root=new Group(),parent=new Group();parent.rotation.z=.6;parent.scale.set(2,1,.5);root.add(parent);
 const a=new Mesh(new BoxGeometry(.1,.2,.3),new MeshStandardMaterial({color:'#f00'})),b=a.clone();b.material=new MeshStandardMaterial({color:'#00f'});a.position.x=-.2;b.position.x=.2;parent.add(a,b);root.updateMatrixWorld(true);
 const original=[a.getWorldPosition(new Vector3()).clone(),b.getWorldPosition(new Vector3()).clone()],material=a.material;
 const parts=createSceneAssembly(root);expect(parts).toHaveLength(2);const assembled=modelBounds(root).clone();
 applyExplosion(parts,1);const expanded=modelBounds(root);expect(expanded.max.x-expanded.min.x).toBeGreaterThan(assembled.max.x-assembled.min.x);expect(a.material).toBe(material);
 applyExplosion(parts,0);root.updateMatrixWorld(true);expect(a.getWorldPosition(new Vector3()).distanceTo(original[0])).toBeLessThan(1e-9);expect(b.getWorldPosition(new Vector3()).distanceTo(original[1])).toBeLessThan(1e-9);
});
it('a translation animation keeps playing underneath an explosion offset',()=>{
 const root=new Group(),a=new Mesh(new BoxGeometry(.1,.1,.1),new MeshStandardMaterial()),b=a.clone();a.name='MovingPart';a.position.x=-.2;b.position.x=.2;root.add(a,b);
 root.animations=[new AnimationClip('motion',1,[new VectorKeyframeTrack('MovingPart.position',[0,1],[-.2,0,0,-.2,.1,0])])];
 const parts=createSceneAssembly(root),playback=new ModelPlayback(root);applyExplosion(parts,1);const offset=parts[0].anchor.position.clone();playback.update(.05);
 expect(a.position.y).toBeGreaterThan(0);expect(parts[0].anchor.position.distanceTo(offset)).toBe(0);playback.dispose();
});
it('does not pretend a joined mesh or a skinned rig is a rigid assembly',()=>{
 const root=new Group();root.add(new Mesh(new BoxGeometry(),new MeshStandardMaterial()));expect(createSceneAssembly(root)).toHaveLength(0);expect(root.userData.explosionReason).toContain('1メッシュ');
 root.add(new SkinnedMesh(new BoxGeometry(),new MeshStandardMaterial()));expect(createSceneAssembly(root)).toHaveLength(0);expect(root.userData.explosionReason).toContain('スキン');
});

it('VR STEP explosion preserves world-space part dimensions and manual scale across repeated slider changes',()=>{
 const left=new BoxGeometry(.1,.08,.06).toNonIndexed().translate(-.14,0,0);
 const right=new BoxGeometry(.1,.08,.06).toNonIndexed().translate(.14,0,0);
 const geometry=new BufferGeometry();
 geometry.setAttribute('position',new Float32BufferAttribute([...left.getAttribute('position').array,...right.getAttribute('position').array],3));
 geometry.computeBoundingSphere();
 const {group,parts}=createAssembly({geometry,dimensions:{width:380,depth:60,height:80},triangles:24,parts:[{name:'left',path:[],start:0,count:12},{name:'right',path:[],start:12,count:12}]},new MeshStandardMaterial());
 group.position.set(.3,1.2,-.5);group.rotation.y=.42;group.scale.setScalar(.7);
 const scale=group.scale.clone(),position=group.position.clone(),rotation=group.quaternion.clone();
 const size=()=>{group.updateWorldMatrix(true,true);return parts.map(p=>new Box3().setFromObject(p.mesh,true).getSize(new Vector3()));};
 const separation=()=>parts[0].mesh.getWorldPosition(new Vector3()).distanceTo(parts[1].mesh.getWorldPosition(new Vector3()));
 const initial=applyRoomExplosion(group,parts,0),before=size();
 for(const fraction of [.1,1,.3,1,0]){
  const extents=applyRoomExplosion(group,parts,fraction);
  expect(group.scale.equals(scale)).toBe(true);expect(group.position.equals(position)).toBe(true);expect(group.quaternion.equals(rotation)).toBe(true);
  size().forEach((s,i)=>expect(s.distanceTo(before[i])).toBeLessThan(1e-7));
  if(fraction>0){expect(extents[0]).toBeGreaterThan(initial[0]);expect(separation()).toBeGreaterThan(0);}
  else{expect(extents[0]).toBeCloseTo(initial[0],8);expect(separation()).toBeLessThan(1e-8);}
 }
 applyRoomExplosion(group,parts,.7);group.scale.setScalar(1.8);
 const zoomed=size();
 applyRoomExplosion(group,parts,0);
 expect(group.scale.x).toBe(1.8);size().forEach((s,i)=>expect(s.distanceTo(zoomed[i])).toBeLessThan(1e-7));
});
it('VR GLB explosion expands the collider at actual size without changing part scale or assembly pose',()=>{
 const root=new Group(),parent=new Group();parent.scale.set(2,1,.5);parent.rotation.z=.6;root.add(parent);
 const a=new Mesh(new BoxGeometry(.1,.2,.3),new MeshStandardMaterial()),b=a.clone();a.position.x=-.2;b.position.x=.2;parent.add(a,b);
 root.rotation.y=.5;root.position.set(0,1,-1);
 const parts=createSceneAssembly(root),centers=[a,b].map(m=>m.getWorldPosition(new Vector3())),sizes=[a,b].map(m=>new Box3().setFromObject(m,true).getSize(new Vector3()));
 const before=applyRoomExplosion(root,parts,0);
 const after=applyRoomExplosion(root,parts,1);
 expect(Math.max(...after)).toBeGreaterThan(Math.max(...before));
 expect(root.scale.toArray()).toEqual([1,1,1]);
 [a,b].forEach((mesh,i)=>expect(new Box3().setFromObject(mesh,true).getSize(new Vector3()).distanceTo(sizes[i])).toBeLessThan(1e-8));
 const restored=applyRoomExplosion(root,parts,0);
 restored.forEach((value,i)=>expect(value).toBeCloseTo(before[i],8));
 [a,b].forEach((mesh,i)=>expect(mesh.getWorldPosition(new Vector3()).distanceTo(centers[i])).toBeLessThan(1e-8));
});
