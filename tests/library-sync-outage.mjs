export default async function({frame,page}){return (frame??page).evaluate(()=>{
 window.__libraryNativeFetch??=window.fetch;
 window.fetch=async function(input,init){if(String(input)==='/api/models'&&(!init?.method||init.method==='GET'))return Response.json({error:'intentional sync outage'},{status:503});return window.__libraryNativeFetch.apply(this,arguments);};return {outage:true};
});}
