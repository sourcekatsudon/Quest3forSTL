export default async function({frame,page}){return await(frame??page).evaluate(async()=>{
 const resources=performance.getEntriesByType('resource').filter(e=>e.name.includes('/ui/')&&(/labels|placeholder/.test(e.name))).map(e=>({name:e.name,bytes:e.transferSize}));
 const checks=[];for(const name of ['reset','add','library']){const r=await fetch('/ui/labels/'+name+'.png');const b=await r.blob();const bmp=await createImageBitmap(b);const c=document.createElement('canvas');c.width=bmp.width;c.height=bmp.height;const ctx=c.getContext('2d');ctx.drawImage(bmp,0,0);const p=ctx.getImageData(0,0,c.width,c.height).data;let opaque=0;for(let i=3;i<p.length;i+=4)if(p[i])opaque++;checks.push({name,status:r.status,bytes:b.size,opaquePixels:opaque});}
 return{resources,checks};
 });}
