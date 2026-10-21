import {sphereStl} from '../server/optimization-fixture.js';
import {mkdir,writeFile} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
const bytes=sphereStl(500,600);const name=`browser-cloud-smoke-optimization-${randomUUID()}.stl`;
await mkdir('artifacts',{recursive:true});await writeFile(`artifacts/${name}`,bytes);
await writeFile('artifacts/optimization-fixture.json',JSON.stringify({name,bytes:bytes.length,triangles:598800,sha256:createHash('sha256').update(bytes).digest('hex')}));
console.log(JSON.stringify({name,bytes:bytes.length}));
