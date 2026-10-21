import {expect,it} from 'vitest';
import {AnimationClip,BoxGeometry,Group,Mesh,MeshStandardMaterial,SkinnedMesh,VectorKeyframeTrack,Vector3} from '@iwsdk/core';
import {applyExplosion,createSceneAssembly,modelBounds} from '../src/assembly';
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
