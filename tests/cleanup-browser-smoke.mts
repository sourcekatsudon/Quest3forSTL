import {loadEnvFile} from 'node:process';
import {readFile} from 'node:fs/promises';
import {del,get,list} from '@vercel/blob';
loadEnvFile('.env.local');
const record=JSON.parse(await readFile('artifacts/cloud-browser-model.json','utf8'));
if(!record.name.startsWith('browser-cloud-smoke-')||!/^[-a-f0-9]{36}$/.test(record.id))throw new Error('Refusing to remove non-test record');
const extension=record.name.split('.').at(-1).toLowerCase();
if(!['stl','step','stp','glb'].includes(extension))throw new Error('Unknown test model extension');
const paths=[`uploads/${record.id}.${extension}`,`uploads/${record.id}.png`,`models/${record.id}.json`];
if(record.format==='step'||record.optimization?.size<record.size)paths.push(`optimized/${record.id}.stl`);
if(record.assemblyUrl)paths.push(`assemblies/${record.id}.json`);
const page=await list({prefix:'library-slots/'});
for(const blob of page.blobs){const value=await get(blob.pathname,{access:'private',useCache:false});if(value?.statusCode===200&&(await new Response(value.stream).json()).id===record.id)paths.push(blob.pathname);}
await del(paths);console.log(JSON.stringify({deletedSyntheticModel:record.id,paths:paths.length}));
