import { beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ blobs: new Map<string, { text: string; etag: string }>(), sequence: 0, reuseSlot: false }));
vi.mock('@vercel/blob', () => {
 class BlobPreconditionFailedError extends Error {}
 return {
  BlobPreconditionFailedError,
  get: vi.fn(async (path: string) => {
   const blob = state.blobs.get(path); if (!blob) return null;
   return { statusCode: 200, stream: new Response(blob.text).body, blob: { size: blob.text.length, etag: blob.etag } };
  }),
  list: vi.fn(async ({ prefix }: { prefix: string }) => ({ blobs: [...state.blobs.keys()].filter(path => path.startsWith(prefix)).map(pathname => ({ pathname })), hasMore: false })),
  put: vi.fn(async (path: string, body: string) => {
   if (state.blobs.has(path)) throw new Error('Already exists');
   state.blobs.set(path, { text: body, etag: String(++state.sequence) });
  }),
  del: vi.fn(async (paths: string | string[], options?: { ifMatch: string }) => {
   for (const path of Array.isArray(paths) ? paths : [paths]) {
    if (state.reuseSlot && path === 'library-slots/00000.json') {
     state.reuseSlot = false; state.blobs.set(path, { text: JSON.stringify(other), etag: 'replacement' });
    }
    const blob = state.blobs.get(path);
    if (options?.ifMatch && blob && options.ifMatch !== blob.etag) throw new BlobPreconditionFailedError();
    state.blobs.delete(path);
   }
  }),
 };
});
import { cloudAsset, cloudLibrary, commitCloudModel, deleteCloudModel } from '../server/cloud-store';
const id = '11111111-1111-4111-8111-111111111111', otherId = '22222222-2222-4222-8222-222222222222';
const original = { id, name: 'same.step', createdAt: '2026-10-22', modelPathname: `uploads/${id}.step`, thumbnailPathname: `uploads/${id}.png`, displayPathname: `optimized/${id}.stl`, assemblyPathname: `assemblies/${id}.json` };
const other = { id: otherId, name: 'same.step', createdAt: '2026-10-22', modelPathname: `uploads/${otherId}.step`, thumbnailPathname: original.thumbnailPathname };
function write(path: string, value: unknown) { state.blobs.set(path, { text: typeof value === 'string' ? value : JSON.stringify(value), etag: String(++state.sequence) }); }
beforeEach(() => {
 process.env.BLOB_READ_WRITE_TOKEN = 'test-placeholder';state.blobs.clear();state.reuseSlot = false;
 write(`models/${id}.json`, original);write('library-slots/00000.json', original);write('library-slots/00001.json', other);
 for (const path of [original.modelPathname, original.thumbnailPathname, original.displayPathname, original.assemblyPathname, other.modelPathname]) write(path, 'fixture');
});
it('removes only the selected model and all unshared derivatives, keeps same-name siblings, and cannot resurrect on retry', async () => {
 await deleteCloudModel(id);await deleteCloudModel(id);
 expect((await cloudLibrary()).models.map(model => model.id)).toEqual([otherId]);
 for (const path of [original.modelPathname, original.displayPathname, original.assemblyPathname, `models/${id}.json`, 'library-slots/00000.json']) expect(state.blobs.has(path)).toBe(false);
 expect(state.blobs.has(other.modelPathname)).toBe(true);expect(state.blobs.has(original.thumbnailPathname)).toBe(true);
 await expect(cloudAsset(id, 'model')).rejects.toMatchObject({ status: 410 });
 await expect(commitCloudModel({ name: 'same.step', modelPathname: original.modelPathname })).rejects.toMatchObject({ status: 410 });
});
it('conditional slot deletion never removes an upload that reused a slot during concurrent deletion', async () => {
 state.reuseSlot = true;await deleteCloudModel(id);
 expect(JSON.parse(state.blobs.get('library-slots/00000.json')!.text).id).toBe(otherId);
 expect((await cloudLibrary()).models.map(model => model.id)).toEqual([otherId]);
});
