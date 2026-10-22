import {afterEach,expect,it,vi} from 'vitest';
import {ModelLibrary} from '../src/library';
afterEach(()=>vi.unstubAllGlobals());
it('shows the server recovery message without erasing models and retries successfully',async()=>{
 const library=new ModelLibrary(),previous={id:'existing'} as never;library.models=[previous];
 const fetch=vi.fn().mockResolvedValueOnce(Response.json({error:'クラウド保存先が停止中です'},{status:503})).mockResolvedValueOnce(Response.json({models:[{id:'new'},{id:'existing'}],storage:'cloud',limits:{maxFileBytes:50,maxModels:100}}));vi.stubGlobal('fetch',fetch);
 await expect(library.refresh()).rejects.toThrow('クラウド保存先が停止中です');expect(library.models).toEqual([previous]);
 expect((await library.refresh()).map(m=>m.id)).toEqual(['new','existing']);expect(library.storage).toBe('cloud');
});
