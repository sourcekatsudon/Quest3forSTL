import { getCache } from '@vercel/functions';
import { createHash, randomUUID } from 'node:crypto';
import { ApiError } from './validation.js';

type Entry<T>={revision:string;value?:T;error?:{status:number;message:string};expires:number};
const ttl=7200, failureTtl=60, suspendedTtl=21600;
const local=new Map<string,{value:unknown;expires:number}>();
const pending=new Map<string,Promise<unknown>>();
function remote(){return process.env.VERCEL==='1'?getCache({namespace:`stl-room:${process.env.VERCEL_PROJECT_ID}:${createHash('sha256').update(process.env.BLOB_READ_WRITE_TOKEN??'unconfigured').digest('hex').slice(0,12)}:catalog-v1`}):null;}
async function read<T>(key:string):Promise<T|undefined>{
 const cache=remote();if(cache)return await cache.get(key) as T|undefined;
 const entry=local.get(key);if(entry&&entry.expires>Date.now())return entry.value as T;
 local.delete(key);return undefined;
}
async function write(key:string,value:unknown,seconds:number){
 const cache=remote();if(cache){await cache.set(key,value,{ttl:seconds});return;}
 local.set(key,{value,expires:Date.now()+seconds*1000});
}
export function storageError(error:unknown):ApiError|undefined{
 if(error instanceof Error&&/Vercel Blob:/i.test(error.message)&&/403|suspend|blocked|quota|limit.?exceed/i.test(error.message))return new ApiError(503,'クラウド保存先が停止中か、アクセスが制限されています。復旧までアップロードをお待ちください。');
 return undefined;
}
/** Shared regional cache: polling must not perform Blob list operations. */
export async function cachedCatalog<T>(kind:string,load:()=>Promise<T>):Promise<T>{
 const existing=pending.get(kind);if(existing)return existing as Promise<T>;
 const task=(async()=>{
  let revision=await read<string>(`${kind}:revision`);
  if(!revision){revision=randomUUID();await write(`${kind}:revision`,revision,ttl*2);}
  const entry=await read<Entry<T>>(kind);
  if(entry?.revision===revision&&entry.expires>Date.now()){
   if(entry.error)throw new ApiError(entry.error.status,entry.error.message);
   return entry.value!;
  }
  try{
   const value=await load();await write(kind,{revision,value,expires:Date.now()+ttl*1000},ttl);return value;
  }catch(error){
   const suspended=storageError(error);
   const failure=suspended??(error instanceof ApiError?error:new ApiError(503,'クラウドとの通信に失敗しました。しばらく待ってから更新してください。'));
   const backoff=suspended?suspendedTtl:failureTtl;
   await write(kind,{revision,error:{status:failure.status,message:failure.message},expires:Date.now()+backoff*1000},backoff);
   throw failure;
  }
 })();
 pending.set(kind,task);
 try{return await task;}finally{if(pending.get(kind)===task)pending.delete(kind);}
}
/** A generation prevents an older in-flight read from repopulating stale data. */
export async function invalidateCatalog(kind:string){await write(`${kind}:revision`,randomUUID(),ttl*2);pending.delete(kind);}
