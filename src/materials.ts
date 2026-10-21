import {CanvasTexture,EquirectangularReflectionMapping,PMREMGenerator,WebGLRenderer,MeshPhysicalMaterial,DoubleSide,Color,Mesh,Object3D,Texture} from '@iwsdk/core';

export function indoorEnvironment(renderer:WebGLRenderer):Texture{
 const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=512;const ctx=canvas.getContext('2d')!;
 const gradient=ctx.createLinearGradient(0,0,0,512);gradient.addColorStop(0,'#c7d6e2');gradient.addColorStop(.42,'#ece7df');gradient.addColorStop(.55,'#8f9699');gradient.addColorStop(1,'#363d43');ctx.fillStyle=gradient;ctx.fillRect(0,0,1024,512);
 for(let i=0;i<4;i++){ctx.fillStyle=i===1?'#ffffff':'#cedce4';ctx.fillRect(40+i*256,65,110,150);ctx.fillStyle='#62686d';ctx.fillRect(i*256+200,190,25,140);}
 const texture=new CanvasTexture(canvas);texture.mapping=EquirectangularReflectionMapping;const generator=new PMREMGenerator(renderer);const result=generator.fromEquirectangular(texture);texture.dispose();generator.dispose();return result.texture;
}
export function surfaceMaterial(preset:string,tint:string):MeshPhysicalMaterial{
 const material=new MeshPhysicalMaterial({color:tint,roughness:.42,metalness:0,side:DoubleSide,envMapIntensity:1});
 if(preset==='glass')material.setValues({color:new Color(tint).lerp(new Color('#ffffff'),.7),roughness:.05,metalness:0,transparent:true,opacity:.27,depthWrite:false,ior:1.5,reflectivity:.8});
 if(preset==='aluminum')material.setValues({metalness:1,roughness:.28,envMapIntensity:1.25});
 if(preset==='sus')material.setValues({metalness:1,roughness:.16,envMapIntensity:1.45});
 if(preset==='plastic')material.setValues({roughness:.38,metalness:0,clearcoat:.25});
 return material;
}
export function replaceSurface(object:Object3D,preset:string,tint:string){
 const material=surfaceMaterial(preset,tint),old=new Set<any>();
 object.traverse(child=>{if(child instanceof Mesh){for(const m of Array.isArray(child.material)?child.material:[child.material])old.add(m);child.material=material;}});
 const textures=new Set<Texture>();old.forEach(m=>{for(const value of Object.values(m))if(value instanceof Texture)textures.add(value);m.dispose();});textures.forEach(texture=>texture.dispose());
}
