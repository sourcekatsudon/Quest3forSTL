import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
export default async function({page,frame,workspaceRoot}){
 const bytes=await readFile(`${workspaceRoot}/tests/fixtures/materials.glb`);
 const result=await(frame??page).evaluate(async bytes=>{
  const {loadGLB,cloneModelScene,disposeParsed,disposeModelScene}=await import('/src/model.ts');
  const parsed=await loadGLB(new Uint8Array(bytes).buffer),copy=cloneModelScene(parsed.scene);
  const bounds=parsed.geometry.boundingBox.clone().setFromObject(copy,true),center=bounds.getCenter(parsed.geometry.boundingSphere.center.clone());
  let textured=0;copy.traverse(node=>{if(node.isMesh&&node.material.map)textured++;});
  const result={dimensions:parsed.dimensions,triangles:parsed.triangles,animationCount:copy.animations.length,textured,center:center.toArray(),width:bounds.max.x-bounds.min.x};
  disposeModelScene(copy);disposeParsed(parsed);return result;
 },Array.from(bytes));
 assert.equal(result.animationCount,0);assert.equal(result.triangles,24);assert.equal(result.textured,2);
 assert.ok(Math.abs(result.dimensions.width-1400)<.001&&Math.abs(result.width-1.4)<1e-5);
 assert.ok(result.center.every(v=>Math.abs(v)<1e-6));return {passed:true,result};
}
