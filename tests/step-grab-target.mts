import {readFile} from 'node:fs/promises';
import {parseSTLData} from '../src/stl-parser';
const {id,scale,position}=JSON.parse(process.argv[2]);
if(!/^[a-f0-9-]{36}$/.test(id))throw new Error('Invalid fixture ID');
const bytes=await readFile(`.stl-room-data/optimized/${id}.stl`);
const data=parseSTLData(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
const assembly=JSON.parse(await readFile(`.stl-room-data/assemblies/${id}.json`,'utf8'));
const p=data.positions;let radius=0;for(let i=0;i<p.length;i+=3)radius=Math.max(radius,Math.hypot(p[i],p[i+1],p[i+2]));
const part=assembly.parts[0],min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
for(let v=part.start*3;v<(part.start+part.count)*3;v++)for(let axis=0;axis<3;axis++){min[axis]=Math.min(min[axis],p[v*3+axis]);max[axis]=Math.max(max[axis],p[v*3+axis]);}
const c=min.map((v,a)=>(v+max[a])/2),length=Math.hypot(...c);
const offset=c.map(v=>v*2+v/length*radius*.55);
const vertex=Array.from(p.slice(part.start*9,part.start*9+3));
const point=vertex.map((v,a)=>(v+offset[a])*scale+position[a]);
console.log(JSON.stringify({x:point[0],y:point[1],z:point[2]}));
