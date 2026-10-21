import {Group,Mesh,CylinderGeometry,SphereGeometry,ShaderMaterial,MeshBasicMaterial} from '@iwsdk/core';

// A thin, one metre Y-up measuring cord; endpoints are at local Y +/- .5.
// Runtime instances change length and direction, sharing these small resources.
const cordGeometry=new CylinderGeometry(.0018,.0018,1,8,1,true);
const stripedMaterial=new ShaderMaterial({
 depthTest:false,depthWrite:false,
 vertexShader:`varying float along;varying float across;
 void main(){along=uv.y*length(modelMatrix[1].xyz);across=uv.x;
 gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
 fragmentShader:`varying float along;varying float across;
 void main(){float stripe=step(.5,fract((along+across*.012)/.024));
 gl_FragColor=vec4(mix(vec3(.035),vec3(1.,.82,.02),stripe),1.);}`,
});
export const dimensionCord=new Group();dimensionCord.name='Dimension cord';
const cord=new Mesh(cordGeometry,stripedMaterial);cord.name='Yellow black cord';cord.renderOrder=1200;dimensionCord.add(cord);

export const dimensionHit=new Group();dimensionHit.name='Measurement hit';
const hit=new Mesh(new SphereGeometry(.004,10,8),new MeshBasicMaterial({color:'#ff162c',depthTest:false,depthWrite:false,toneMapped:false}));
hit.name='Red target';hit.renderOrder=1202;dimensionHit.add(hit);

export const dimensionLaser=new Group();dimensionLaser.name='Finger laser';
const laser=new Mesh(new CylinderGeometry(.0005,.0005,1,6,1,true),new MeshBasicMaterial({color:'#ffe883',depthTest:false,depthWrite:false,toneMapped:false}));
laser.name='Yellow laser';laser.renderOrder=1201;dimensionLaser.add(laser);
