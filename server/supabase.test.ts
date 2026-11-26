import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assetRedirect, bytes, entries, rpc, signUpload, storagePath, usesSupabase } from './supabase-rest.js';
import { ApiError } from './validation.js';

test('Supabase REST uses server credentials only for server requests, validates paths and limits bytes', async () => {
 const before = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY, bucket: process.env.SUPABASE_STORAGE_BUCKET, mode: process.env.STL_STORAGE_BACKEND };
 const real = globalThis.fetch;
 const id='12345678-1234-1234-1234-123456789abc', path='uploads/'+id+'.stl';
 const seen: string[]=[];
 try {
  process.env.SUPABASE_URL='https://test.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY='fake-secret'; process.env.SUPABASE_STORAGE_BUCKET='stl-room-assets'; process.env.STL_STORAGE_BACKEND='supabase';
  assert.equal(usesSupabase(),true);
  assert.throws(()=>storagePath('../secret'),ApiError);
  globalThis.fetch=async (url, init) => {
   const target=String(url); seen.push(target);
   assert.equal(new Headers(init?.headers).get('apikey'),'fake-secret');
   assert.equal(new Headers(init?.headers).get('Authorization'),'Bearer fake-secret');
   if(target.includes('/upload/sign/')) return Response.json({url:'/object/upload/sign/stl-room-assets/'+path+'?token=upload-token'});
   if(target.includes('/object/sign/')) return Response.json({signedURL:'/object/sign/stl-room-assets/'+path+'?token=read-token'});
   if(target.includes('/authenticated/')) return new Response(new Uint8Array([1,2,3]));
   if(target.includes('/rpc/stl_room_rate')) return new Response(null,{status:204});
   if(target.includes('/rpc/stl_room_reserve')) return Response.json({code:'P0001',message:'quota'},{status:400});
   if(target.includes('/rest/v1/')) return Response.json([]);
   throw new Error('unexpected request');
  };
  const ticket=await signUpload(path);
  assert.equal(ticket,'https://test.supabase.co/storage/v1/object/upload/sign/stl-room-assets/'+path+'?token=upload-token');
  assert.ok(!ticket.includes('fake-secret'));
  const asset=await assetRedirect(path);
  assert.equal(asset.status,302);
  assert.match(asset.headers.get('Location')!,/token=read-token$/);
  assert.deepEqual(await bytes(path,3),new Uint8Array([1,2,3]));
  await assert.rejects(bytes(path,2),(e:unknown)=>e instanceof ApiError && e.status===413);
  assert.equal(await rpc('stl_room_rate',{p_ip:'test'}),undefined);
  await assert.rejects(rpc('stl_room_reserve',{}),(e:unknown)=>e instanceof ApiError && e.status===409);
  assert.deepEqual(await entries('model'),[]);
  assert.ok(seen.some(url=>url.includes('/rest/v1/stl_room_entries?')));
  assert.ok(!seen.some(url=>url.includes('fake-secret')));
 } finally {
  globalThis.fetch=real;
  for (const [key,value] of Object.entries({SUPABASE_URL:before.url,SUPABASE_SERVICE_ROLE_KEY:before.key,SUPABASE_STORAGE_BUCKET:before.bucket,STL_STORAGE_BACKEND:before.mode})) {
   if(value===undefined) delete process.env[key]; else process.env[key]=value;
  }
 }
});
