export default async function({frame,page}){const app=frame??page;if(await app.locator('.photo-dialog[open]').count())await app.locator('.photo-close').click();return {closed:true};}
