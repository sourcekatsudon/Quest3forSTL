import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { get, list, put } from '@vercel/blob';
import sharp from 'sharp';
import { photoLimits, type PhotoRecord } from '../shared/photos.js';
import { ApiError, idPattern } from './validation.js';

interface StoredPhoto extends PhotoRecord { digest: string }
const prefix = 'photo-slots/';
const options = { access: 'private', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: false } as const;
export function photoId(value: string | null): string {
 if (!value || !idPattern.test(value)) throw new ApiError(400, '写真の指定が正しくありません。');
 return value.toLowerCase();
}
export async function preparePhoto(bytes: Uint8Array) {
 if (!bytes.length || bytes.length > photoLimits.maxBytes) throw new ApiError(413, '写真は3 MB以下で保存してください。');
 try {
  const image = sharp(bytes, { limitInputPixels: 4_000_000, failOn: 'warning' });
  const metadata = await image.metadata();
  if (!['jpeg', 'png'].includes(metadata.format ?? '') || (metadata.pages ?? 1) !== 1) throw new Error('format');
  // Decode fully, strip metadata, and cap storage size independently of client headers.
  const { data, info } = await image.resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).flatten({ background: '#edf0f3' }).jpeg({ quality: 88 }).toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, digest: createHash('sha256').update(bytes).digest('hex') };
 } catch { throw new ApiError(422, '写真データが壊れているか、対応していない形式です。'); }
}
function record(id: string, image: Awaited<ReturnType<typeof preparePhoto>>): StoredPhoto {
 return { id, createdAt: new Date().toISOString(), width: image.width, height: image.height, size: image.data.length, imageUrl: `/api/photos?id=${id}`, content: 'virtual-scene', digest: image.digest };
}
function publicPhoto({ digest: _digest, ...photo }: StoredPhoto): PhotoRecord { return photo; }
function existing(photo: StoredPhoto, digest: string): PhotoRecord {
 if (photo.digest !== digest) throw new ApiError(409, '同じ写真IDで異なる画像は保存できません。');
 return publicPhoto(photo);
}
async function readCloud(path: string): Promise<StoredPhoto> {
 const result = await get(path, { access: 'private', useCache: false });
 if (!result || result.statusCode !== 200) throw new ApiError(404, '写真が見つかりません。');
 return new Response(result.stream).json() as Promise<StoredPhoto>;
}
async function cloudPaths() {
 if (!process.env.BLOB_READ_WRITE_TOKEN) throw new ApiError(503, 'クラウド保存の接続設定が必要です。');
 const page = await list({ prefix, limit: 1000 });
 return page.blobs.map(blob => blob.pathname).filter(path => /^photo-slots\/\d{3}\.json$/.test(path));
}
export async function listCloudPhotos(): Promise<PhotoRecord[]> {
 const paths = await cloudPaths(), photos: PhotoRecord[] = [];
 for (let i = 0; i < paths.length; i += 10) photos.push(...await Promise.all(paths.slice(i, i + 10).map(async path => publicPhoto(await readCloud(path)))));
 return photos.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export async function saveCloudPhoto(id: string, bytes: Uint8Array): Promise<PhotoRecord> {
 photoId(id);
 const image = await preparePhoto(bytes), occupied = new Set(await cloudPaths());
 let priorManifest:StoredPhoto|undefined;
 try { priorManifest=await readCloud(`photos/${id}.json`); existing(priorManifest,image.digest); }
 catch (error) { if (!(error instanceof ApiError && error.status === 404)) throw error; }
 if(priorManifest){for(const path of occupied){const prior=await readCloud(path);if(prior.id===id)return existing(prior,image.digest);}}
 if (occupied.size >= photoLimits.maxPhotos) throw new ApiError(409, '写真の保存上限（200枚）に達しました。');
 let stored = record(id, image);
 try { await put(`photos/${id}.jpg`, image.data, { ...options, contentType: 'image/jpeg' }); }
 catch (error) {
  // A retry may already have written these bytes. Verify rather than overwrite.
  const saved = await get(`photos/${id}.jpg`, { access: 'private', useCache: false });
  if (!saved || saved.statusCode !== 200) throw error;
  const prior = new Uint8Array(await new Response(saved.stream).arrayBuffer());
  if (!Buffer.from(prior).equals(image.data)) throw new ApiError(409, '写真IDが重複しました。');
 }
 try { await put(`photos/${id}.json`, JSON.stringify(stored), options); }
 catch { stored = await readCloud(`photos/${id}.json`); existing(stored, image.digest); }
 for (let slot = 0; slot < photoLimits.maxPhotos; slot++) {
  const path = `${prefix}${String(slot).padStart(3, '0')}.json`;
  if (occupied.has(path)) { const prior = await readCloud(path); if (prior.id === id) return existing(prior, image.digest); continue; }
  try { await put(path, JSON.stringify(stored), options); return publicPhoto(stored); }
  catch (error) { let prior: StoredPhoto; try { prior = await readCloud(path); } catch { throw error; } if (prior.id === id) return existing(prior, image.digest); }
 }
 throw new ApiError(409, '写真の保存上限（200枚）に達しました。');
}
export async function cloudPhotoAsset(id: string): Promise<Response> {
 photoId(id);
 const result = await get(`photos/${id}.jpg`, { access: 'private' });
 if (!result || result.statusCode !== 200) throw new ApiError(404, '写真が見つかりません。');
 return new Response(result.stream, { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' } });
}
export class LocalPhotoStore {
 private writes: Promise<unknown> = Promise.resolve();
 constructor(private directory = join(resolve(process.env.STL_LOCAL_DIR || '.stl-room-data'), 'photos')) {}
 async list(): Promise<PhotoRecord[]> {
  await mkdir(this.directory, { recursive: true });
  const names = (await readdir(this.directory)).filter(name => name.endsWith('.json'));
  return (await Promise.all(names.map(async name => publicPhoto(JSON.parse(await readFile(join(this.directory, name), 'utf8')))))).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
 }
 async save(id: string, bytes: Uint8Array): Promise<PhotoRecord> {
  photoId(id); const image = await preparePhoto(bytes);
  const operation = this.writes.then(async () => {
   await mkdir(this.directory, { recursive: true });
   try { return existing(JSON.parse(await readFile(join(this.directory, `${id}.json`), 'utf8')), image.digest); }
   catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
   if ((await this.list()).length >= photoLimits.maxPhotos) throw new ApiError(409, '写真の保存上限（200枚）に達しました。');
   const photo = record(id, image);
   await writeFile(join(this.directory, `${id}.jpg`), image.data);
   await writeFile(join(this.directory, `${id}.json`), JSON.stringify(photo));
   return publicPhoto(photo);
  });
  this.writes = operation.catch(() => undefined); return operation;
 }
 async asset(id: string): Promise<Buffer> {
  photoId(id);
  try { return await readFile(join(this.directory, `${id}.jpg`)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new ApiError(404, '写真が見つかりません。'); throw error; }
 }
}
