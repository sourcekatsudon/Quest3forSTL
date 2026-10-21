import {Document,NodeIO} from '@gltf-transform/core';
import {writeFile} from 'node:fs/promises';
import sharp from 'sharp';
const doc=new Document(),buffer=doc.createBuffer();
const points=[[-.2,-.15,-.1],[.2,-.15,-.1],[.2,.15,-.1],[-.2,.15,-.1],[-.2,-.15,.1],[.2,-.15,.1],[.2,.15,.1],[-.2,.15,.1]];
const indices=[0,2,1,0,3,2,4,5,6,4,6,7,0,1,5,0,5,4,1,2,6,1,6,5,2,3,7,2,7,6,3,0,4,3,4,7];
const pos=doc.createAccessor().setType('VEC3').setArray(new Float32Array(points.flat())).setBuffer(buffer);
const ind=doc.createAccessor().setType('SCALAR').setArray(new Uint16Array(indices)).setBuffer(buffer);
const uv=doc.createAccessor().setType('VEC2').setArray(new Float32Array([0,0,1,0,1,1,0,1,0,0,1,0,1,1,0,1])).setBuffer(buffer);
const raw=Buffer.alloc(16*16*3);for(let y=0;y<16;y++)for(let x=0;x<16;x++){const i=(y*16+x)*3,color=((x>>2)+(y>>2))%2?[220,60,30]:[30,100,210];raw.set(color,i);}
const image=await sharp(raw,{raw:{width:16,height:16,channels:3}}).png().toBuffer();
const texture=doc.createTexture('checker').setImage(image).setMimeType('image/png');
const material=doc.createMaterial('Textured metal').setBaseColorTexture(texture).setMetallicFactor(.6).setRoughnessFactor(.22);
const primitive=doc.createPrimitive().setAttribute('POSITION',pos).setAttribute('TEXCOORD_0',uv).setIndices(ind).setMaterial(material);
const mesh=doc.createMesh('Block').addPrimitive(primitive),scene=doc.createScene('Two blocks');
scene.addChild(doc.createNode('First').setMesh(mesh));scene.addChild(doc.createNode('Second').setMesh(mesh).setTranslation([1,0,0]));doc.getRoot().setDefaultScene(scene);
await writeFile('tests/fixtures/materials.glb',await new NodeIO().writeBinary(doc));
console.log('Generated self-contained GLB fixture');
