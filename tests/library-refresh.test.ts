import {afterEach,expect,it,vi} from 'vitest';
import {ModelLibrary} from '../src/library';
afterEach(()=>vi.unstubAllGlobals());
it('shows the server recovery message without erasing models and retries successfully',async()=>{
 const library=new ModelLibrary(),previous={id:'existing'} as never;library.models=[previous];
 const fetch=vi.fn().mockResolvedValueOnce(Response.json({error:'クラウド保存先が停止中です'},{status:503})).mockResolvedValueOnce(Response.json({models:[{id:'new'},{id:'existing'}],storage:'cloud',limits:{maxFileBytes:50,maxModels:100}}));vi.stubGlobal('fetch',fetch);
 await expect(library.refresh()).rejects.toThrow('クラウド保存先が停止中です');expect(library.models).toEqual([previous]);
 expect((await library.refresh()).map(m=>m.id)).toEqual(['new','existing']);expect(library.storage).toBe('cloud');
});

it('retains a successfully transferred Supabase object after a commit timeout, then reuses it',async()=>{
 const library=new ModelLibrary();
 const model={id:'saved',name:'sample.step'};
 const file=new File(['ISO-10303-21;'], 'sample.step',{type:'model/step'});
 let path:string|undefined;
 const commitBodies:unknown[]=[];
 let commits=0, tickets=0, puts=0;
 const fetch=vi.fn(async (url:string, init?:RequestInit)=>{
  if(url==='/api/models' && !init?.method)return Response.json({models:[],storage:'cloud',uploadBackend:'supabase',limits:{maxFileBytes:10000,maxModels:100}});
  if(url==='/api/upload'){tickets++; path=JSON.parse(String(init?.body)).pathname;return Response.json({pathname:path,url:'https://example.test/upload'});}
  if(url==='https://example.test/upload'){puts++;return new Response(null,{status:200});}
  if(url==='/api/models' && init?.method==='POST'){
   commits++;commitBodies.push(JSON.parse(String(init.body)));
   return commits===1?new Response('FUNCTION_INVOCATION_TIMEOUT',{status:504}):Response.json({model},{status:201});
  }
  throw Error('unexpected request');
 });
 vi.stubGlobal('fetch',fetch);
 await library.refresh();
 await expect(library.save(file)).rejects.toThrow('ファイル本体は保存済み');
 expect(await library.save(new File(['ISO-10303-21;'],'sample.step'))).toEqual(model);
 expect(tickets).toBe(1);expect(puts).toBe(1);expect(commits).toBe(2);
 expect(commitBodies).toEqual([{name:file.name,modelPathname:path},{name:file.name,modelPathname:path}]);
});
