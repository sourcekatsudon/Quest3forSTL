import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { LocalPhotoStore, photoId, preparePhoto } from './photos';
import { GET, POST } from '../api/photos';
import { ApiError } from './validation';
import { photoLimits } from '../shared/photos';
test('photos decode fully, persist across server instances, retry without duplicates and preserve pixels',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'quest-photo-'));
 try{
  const bytes=await sharp({create:{width:640,height:480,channels:3,background:'#31a78d'}}).png().toBuffer(),id=randomUUID();
  const store=new LocalPhotoStore(dir);const records=await Promise.all([store.save(id,bytes),store.save(id,bytes)]);
  assert.equal(records[0].id,records[1].id);
  const reopened=new LocalPhotoStore(dir),photos=await reopened.list();assert.equal(photos.length,1);assert.equal(photos[0].width,640);assert.equal(photos[0].content,'virtual-scene');assert.ok(!('digest' in photos[0]));
  const saved=await reopened.asset(id),metadata=await sharp(saved).metadata();assert.equal(metadata.format,'jpeg');assert.equal(metadata.height,480);
  const pixel=await sharp(saved).raw().toBuffer();assert.ok(Math.abs(pixel[0]-49)<5&&Math.abs(pixel[1]-167)<5);
  await assert.rejects(store.save(id,await sharp({create:{width:10,height:10,channels:3,background:'#fff'}}).png().toBuffer()),(e:unknown)=>e instanceof ApiError&&e.status===409);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('invalid paths, corrupt images, oversized bodies and foreign origins are rejected',async()=>{
 assert.throws(()=>photoId('../../secret'));await assert.rejects(preparePhoto(new Uint8Array(100)));await assert.rejects(preparePhoto(new Uint8Array(photoLimits.maxBytes+1)));
 const headerOnly=Buffer.from([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,1,0,0,0,1,0]);await assert.rejects(preparePhoto(headerOnly));
 assert.equal((await GET(new Request('https://example.com/api/photos?id=../secret'))).status,400);
 assert.equal((await POST(new Request(`https://example.com/api/photos?id=${randomUUID()}`,{method:'POST',headers:{origin:'https://foreign.example'},body:'x'}))).status,403);
});
