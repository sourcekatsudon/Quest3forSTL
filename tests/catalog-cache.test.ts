import {afterEach,expect,it,vi} from 'vitest';
import {cachedCatalog,invalidateCatalog} from '../server/catalog-cache';
const key=()=>crypto.randomUUID();
afterEach(()=>vi.useRealTimers());
it('shares repeated and concurrent reads, then reloads after a successful write invalidates the catalog',async()=>{
 const kind=key(),load=vi.fn(async()=>['first']);
 await Promise.all(Array.from({length:12},()=>cachedCatalog(kind,load)));
 expect(load).toHaveBeenCalledTimes(1);
 await invalidateCatalog(kind);load.mockResolvedValue(['new model','first']);
 expect(await cachedCatalog(kind,load)).toEqual(['new model','first']);expect(load).toHaveBeenCalledTimes(2);
});
it('does not let an older in-flight read hide a model committed during that read',async()=>{
 const kind=key();let release!:(value:string[])=>void,started!:()=>void;
 const entered=new Promise<void>(resolve=>{started=resolve;});
 const old=cachedCatalog(kind,()=>{started();return new Promise<string[]>(resolve=>{release=resolve;});});
 await entered;await invalidateCatalog(kind);
 const fresh=vi.fn(async()=>['new model','old model']);await cachedCatalog(kind,fresh);
 release(['old model']);await old;
 expect(await cachedCatalog(kind,fresh)).toEqual(['new model','old model']);
});
it('backs off a suspended store for six hours so polling cannot extend a quota suspension',async()=>{
 vi.useFakeTimers();const kind=key(),load=vi.fn(async()=>{throw new Error('Vercel Blob: Failed to fetch blob: 403 Forbidden');});
 for(let i=0;i<5;i++)await expect(cachedCatalog(kind,load)).rejects.toMatchObject({status:503});
 vi.advanceTimersByTime(3_600_000);await expect(cachedCatalog(kind,load)).rejects.toMatchObject({status:503});
 expect(load).toHaveBeenCalledTimes(1);vi.advanceTimersByTime(18_001_000);
 const recovered=vi.fn(async()=>['preserved model']);expect(await cachedCatalog(kind,recovered)).toEqual(['preserved model']);
});
it('retries ordinary transient failures after 60 seconds',async()=>{
 vi.useFakeTimers();const kind=key(),load=vi.fn(async()=>{throw new Error('network unavailable');});
 await expect(cachedCatalog(kind,load)).rejects.toMatchObject({status:503});
 await expect(cachedCatalog(kind,load)).rejects.toMatchObject({status:503});expect(load).toHaveBeenCalledTimes(1);
 vi.advanceTimersByTime(61_000);const recovered=vi.fn(async()=>['preserved model']);expect(await cachedCatalog(kind,recovered)).toEqual(['preserved model']);
});
it('periodically refreshes an unchanged library after the shared cache TTL',async()=>{
 vi.useFakeTimers();const kind=key(),load=vi.fn(async()=>[]);await cachedCatalog(kind,load);vi.advanceTimersByTime(7_201_000);await cachedCatalog(kind,load);expect(load).toHaveBeenCalledTimes(2);
});
