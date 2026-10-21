import {Document,NodeIO} from '@gltf-transform/core';
import {writeFile} from 'node:fs/promises';
const doc=new Document(),buffer=doc.createBuffer();
const accessor=(type:'SCALAR'|'VEC3'|'VEC4'|'MAT4',values:number[],integer=false)=>doc.createAccessor().setType(type).setArray(integer?new Uint16Array(values):new Float32Array(values)).setBuffer(buffer);
const primitive=doc.createPrimitive()
 .setAttribute('POSITION',accessor('VEC3',[-.1,-.1,0,.1,-.1,0,.1,.1,0,-.1,.1,0]))
 .setAttribute('NORMAL',accessor('VEC3',[0,0,1,0,0,1,0,0,1,0,0,1]))
 .setAttribute('JOINTS_0',accessor('VEC4',new Array(16).fill(0),true))
 .setAttribute('WEIGHTS_0',accessor('VEC4',[1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0]))
 .setIndices(accessor('SCALAR',[0,1,2,0,2,3],true))
 .setMaterial(doc.createMaterial('Orange').setBaseColorFactor([.85,.32,.12,1]).setDoubleSided(true));
primitive.addTarget(doc.createPrimitiveTarget().setAttribute('POSITION',accessor('VEC3',[0,0,0,0,0,0,0,0,.08,0,0,.08])));
const mesh=doc.createMesh('Plate').addPrimitive(primitive).setWeights([0]);
const joint=doc.createNode('AnimatedJoint');
const skin=doc.createSkin('Rig').addJoint(joint).setSkeleton(joint).setInverseBindMatrices(accessor('MAT4',[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]));
const node=doc.createNode('AnimatedPlate').setMesh(mesh).setSkin(skin).setWeights([0]);
const scene=doc.createScene('Animated fixture').addChild(node).addChild(joint);doc.getRoot().setDefaultScene(scene);
const times=accessor('SCALAR',[0,1,2]);
const motion=doc.createAnimation('Motion');
for(const [target,path,output] of [
 [joint,'translation',accessor('VEC3',[0,0,0,0,.08,0,0,0,0])],
 [node,'weights',accessor('SCALAR',[0,1,0])],
 [node,'scale',accessor('VEC3',[1,1,1,1.2,1.2,1.2,1,1,1])],
] as const){
 const sampler=doc.createAnimationSampler().setInput(times).setOutput(output).setInterpolation('LINEAR');
 motion.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(target).setTargetPath(path).setSampler(sampler));
}
const alternateSampler=doc.createAnimationSampler().setInput(times).setOutput(accessor('VEC3',[1,1,1,.5,.5,.5,1,1,1]));
doc.createAnimation('Alternate').addSampler(alternateSampler).addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath('scale').setSampler(alternateSampler));
await writeFile('tests/fixtures/animated.glb',await new NodeIO().writeBinary(doc));
console.log('Created embedded GLB with joint, morph and node animation.');
