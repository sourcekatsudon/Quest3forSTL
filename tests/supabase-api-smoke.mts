// Opt-in integration smoke test. It modifies only a synthetic UUID fixture.
// Run against a preview/staging instance using the Supabase backend, not production.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';

const target = process.argv[2];
if (!target) throw new Error('Usage: npx tsx tests/supabase-api-smoke.mts https://preview-url');
const base = new URL(target);
if (base.protocol !== 'https:' && base.hostname !== 'localhost') throw new Error('HTTPS required');
const id = randomUUID();
const pathname = 'uploads/' + id + '.stl';
const original = new TextEncoder().encode('solid smoke\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 10 0 0\nvertex 0 10 0\nendloop\nendfacet\nendsolid smoke');
const hash = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
const url = (path: string) => new URL(path,base);
async function json(path: string, init?: RequestInit) {
 const response = await fetch(url(path),init);
 assert.ok(response.ok, path + ' returned ' + response.status);
 return response.json();
}
const headers = { 'Content-Type':'application/json','Origin':base.origin };
const before = await json('/api/models');
assert.equal(before.uploadBackend,'supabase');
assert.ok(!before.models.some((model:{id:string})=>model.id===id));
let published = false;
try {
 const ticket = await json('/api/upload',{method:'POST',headers,body:JSON.stringify({pathname,size:original.byteLength})});
 assert.equal(ticket.pathname,pathname);
 assert.ok(new URL(ticket.url).searchParams.has('token'));
 const upload = await fetch(ticket.url,{method:'PUT',headers:{'Content-Type':'model/stl','x-upsert':'false'},body:original});
 assert.ok(upload.ok,'direct upload returned '+upload.status);
 const commit = {name:'supabase-smoke.stl',modelPathname:pathname};
 const saved = await json('/api/models',{method:'POST',headers,body:JSON.stringify(commit)});
 published = true;
 assert.equal(saved.model.id,id);
 const repeat = await json('/api/models',{method:'POST',headers,body:JSON.stringify(commit)});
 assert.deepEqual(repeat.model,saved.model);
 const after = await json('/api/models');
 assert.ok(after.models.some((model:{id:string})=>model.id===id));
 const asset = await fetch(url(saved.model.originalModelUrl),{redirect:'follow'});
 assert.ok(asset.ok,'original returned '+asset.status);
 assert.equal(hash(new Uint8Array(await asset.arrayBuffer())),hash(original));
 const removed = await fetch(url('/api/models?id='+id),{method:'DELETE',headers:{Origin:base.origin}});
 assert.equal(removed.status,204);
 published = false;
 const final = await json('/api/models');
 assert.ok(!final.models.some((model:{id:string})=>model.id===id));
 assert.ok(before.models.every((model:{id:string})=>final.models.some((other:{id:string})=>other.id===model.id)),'preexisting models must remain');
 console.log('Supabase API smoke passed: direct upload, idempotent commit, catalog, original hash and delete.');
} finally {
 if (published) {
   const cleanup = await fetch(url('/api/models?id='+id),{method:'DELETE',headers:{Origin:base.origin}});
   if (!cleanup.ok) console.error('Fixture cleanup failed for ID '+id);
 }
}
