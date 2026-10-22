export const APP_URL='https://qstl.vercel.app/';

export function getShareURL(current:string):string{
 const url=new URL(current);
 if(url.hostname.endsWith('.vercel.app'))return APP_URL;
 // Keep local network URLs usable when testing with a nearby Quest.
 url.hash='';url.search='';return url.toString();
}
