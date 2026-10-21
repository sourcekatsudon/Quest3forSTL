export default async function({frame,page}){
 const app=frame??page;
 await app.locator('.xr-entry').click();
 return {clicked:true};
}
