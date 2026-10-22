import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
export default async function({context,workspaceRoot}){
 const page=await context.newPage(),id=randomUUID(),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await writeFile(`${workspaceRoot}/artifacts/photo-cloud-id.json`,JSON.stringify({id}));
 try{
  await page.goto('https://qstl.vercel.app/',{waitUntil:'networkidle'});
  const bytes=Array.from(await readFile(`${workspaceRoot}/artifacts/photo-capture.jpg`));
  const saved=await page.evaluate(async({id,bytes})=>{
   const save=()=>fetch(`/api/photos?id=${id}`,{method:'POST',headers:{'Content-Type':'image/jpeg'},body:new Uint8Array(bytes)});
   const a=await save(),b=await save();return{status:a.status,retry:b.status,a:await a.json(),b:await b.json()};
  },{id,bytes});
  assert.equal(saved.status,201,JSON.stringify(saved.a));assert.equal(saved.retry,201);assert.deepEqual(saved.a,saved.b);
  await page.locator('.photos-button').click();await page.locator(`.photo-card img[src$="${id}"]`).waitFor();
  const image=page.locator(`.photo-card img[src$="${id}"]`);await image.evaluate(img=>img.decode());assert.ok(await image.evaluate(img=>img.naturalWidth>1000));
  await page.reload({waitUntil:'networkidle'});await page.locator('.photos-button').click();await page.locator(`.photo-card img[src$="${id}"]`).waitFor();
  assert.equal(await page.locator(`.photo-card img[src$="${id}"]`).count(),1);
  const bad=await page.evaluate(async()=>{const response=await fetch('/api/photos?id=../../secret');return response.status;});assert.equal(bad,400);assert.deepEqual(errors,[]);
  const result={passed:true,id,cloudSaved:true,idempotent:true,galleryAfterReload:true,width:saved.a.photo.width,height:saved.a.photo.height,errors};
  await writeFile(`${workspaceRoot}/artifacts/photo-cloud-results.json`,JSON.stringify(result,null,2));return result;
 }finally{await page.close();}
}
