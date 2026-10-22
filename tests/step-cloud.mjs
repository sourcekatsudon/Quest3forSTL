import {stepFlow} from './step.e2e.mjs';
export default async function({context,workspaceRoot}){
  const page=await context.newPage();
  try{
    await page.goto('https://qstl.vercel.app/',{waitUntil:'networkidle'});
    await page.locator('.storage-text').filter({hasText:'クラウドと同期'}).waitFor();
    return await stepFlow({page,app:page,workspaceRoot,cloud:true});
  }finally{await page.close();}
}
