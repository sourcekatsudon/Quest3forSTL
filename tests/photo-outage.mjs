export default async function({frame,page}){
 return (frame??page).evaluate(()=>{
  const native=window.fetch;
  window.fetch=async function(input,init){if(String(input).startsWith('/api/photos?')&&init?.method==='POST'){window.fetch=native;return new Response(JSON.stringify({error:'intentional test outage'}),{status:503,headers:{'Content-Type':'application/json'}});}return native.apply(this,arguments);};return {nextPhotoUploadFails:true};
 });
}
