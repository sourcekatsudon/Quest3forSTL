import { Group, LatheGeometry, Mesh, ShaderMaterial, Vector2 } from '@iwsdk/core';

// Wrist at the origin; +Z points toward the elbow. This is a visual estimate,
// not an elbow/body tracker. The far end fades out rather than inventing an elbow.
const geometry = new LatheGeometry([
 new Vector2(.024, 0), new Vector2(.027, .025), new Vector2(.033, .08),
 new Vector2(.039, .15), new Vector2(.04, .21), new Vector2(.038, .25),
], 16);
geometry.rotateX(Math.PI / 2);
const material = new ShaderMaterial({
 transparent: true, depthWrite: false, depthTest: false,
 vertexShader: `varying float along;
 void main(){along=position.z;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
 fragmentShader: `varying float along;
 void main(){float a=.19*(1.-smoothstep(.08,.25,along));gl_FragColor=vec4(.69,.88,1.,a);}`,
});
export const forearmGhost = new Group();
forearmGhost.name = 'Estimated forearm ghost';
const sleeve = new Mesh(geometry, material);
sleeve.name = 'Fading forearm';
sleeve.renderOrder = 1000;
forearmGhost.add(sleeve);
