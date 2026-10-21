import {Scene,Color,HemisphereLight,DirectionalLight,Mesh,MeshStandardMaterial,PerspectiveCamera,WebGLRenderTarget,WebGLRenderer,Vector4} from '@iwsdk/core';
import type {ParsedModel} from './model';
export function renderThumbnail(renderer:WebGLRenderer,parsed:ParsedModel):string{
 const scene=new Scene();scene.background=new Color('#edf2f3');scene.add(new HemisphereLight(0xffffff,0x657985,3));
 const light=new DirectionalLight(0xffffff,3);light.position.set(2,4,3);scene.add(light);
 const material=new MeshStandardMaterial({color:0x879ba3,roughness:.45});
 const object=parsed.scene??new Mesh(parsed.geometry,material);scene.add(object);
 const radius=parsed.geometry.boundingSphere?.radius??.1,d=radius/Math.sin(Math.PI/12)*1.1;
 const camera=new PerspectiveCamera(30,1,Math.max(radius/1000,.000001),Math.max(radius*100,100));camera.position.set(d*.65,d*.45,d*.65);camera.lookAt(0,0,0);
 const target=new WebGLRenderTarget(256,256),previous=renderer.getRenderTarget(),xr=renderer.xr.enabled,viewport=renderer.getViewport(new Vector4());
 try{
  renderer.xr.enabled=false;renderer.setRenderTarget(target);renderer.render(scene,camera);
  const bytes=new Uint8Array(256*256*4);renderer.readRenderTargetPixels(target,0,0,256,256,bytes);
  const canvas=document.createElement('canvas');canvas.width=canvas.height=256;const ctx=canvas.getContext('2d')!,pixels=ctx.createImageData(256,256);
  for(let y=0;y<256;y++)pixels.data.set(bytes.subarray((255-y)*1024,(256-y)*1024),y*1024);
  ctx.putImageData(pixels,0,0);return canvas.toDataURL('image/png');
 }finally{renderer.setRenderTarget(previous);renderer.setViewport(viewport);renderer.xr.enabled=xr;scene.remove(object);material.dispose();target.dispose();}
}
