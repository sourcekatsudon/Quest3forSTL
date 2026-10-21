import { get, list, put } from '@vercel/blob';
import { Redis } from '@upstash/redis';
import { createHash } from 'node:crypto';
import { prepareModel } from './prepare-model.js';
import type { LibraryResponse, ModelCommit, ModelRecord } from '../shared/models';
import { ApiError, inspectStl, limits, MAX_THUMBNAIL_BYTES, validateName, validatePath, validatePng } from './validation.js';

interface StoredModel extends ModelRecord { modelPathname: string; thumbnailPathname?: string; displayPathname?: string; assemblyPathname?: string }
const PENDING = 'stl-room:v1:pending';
const SLOT_PREFIX = 'library-slots/';
let client: Redis | undefined;
const rates = new Map<string, { count: number; expires: number }>();
function requireBlob() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) throw new ApiError(503, 'クラウド保存の接続設定が必要です。');
}
function optionalRedis(): Redis | undefined {
  requireBlob();
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) return undefined;
  return client ??= Redis.fromEnv();
}
function publicRecord(stored: StoredModel): ModelRecord {
  const { modelPathname: _model, thumbnailPathname: _thumbnail, displayPathname: _display, assemblyPathname: _assembly, ...record } = stored;
  return record;
}

async function slotPaths(): Promise<string[]> {
  requireBlob();
  const paths: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: SLOT_PREFIX, cursor, limit: 1000 });
    for (const blob of page.blobs) if (/^library-slots\/\d{5}\.json$/.test(blob.pathname)) paths.push(blob.pathname);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return paths;
}

export async function cloudLibrary(): Promise<LibraryResponse> {
  const paths = await slotPaths();
  const records: ModelRecord[] = [];
  // Bound simultaneous fetches even if the library limit is configured larger.
  for (let offset = 0; offset < paths.length; offset += 10) {
    const batch = await Promise.all(paths.slice(offset, offset + 10).map(async (path) => publicRecord(await readManifest(path))));
    records.push(...batch);
  }
  const models = [...new Map(records.map((record) => [record.id, record])).values()];
  return { models: models.sort((a, b) => b.createdAt.localeCompare(a.createdAt)), storage: 'cloud', limits };
}

export async function rateLimit(request: Request) {
  const ip = (request.headers.get('x-forwarded-for') || 'unknown').split(',')[0].trim();
  const digest = createHash('sha256').update(ip).digest('hex').slice(0, 24);
  const redis = optionalRedis();
  let count: number;
  if (redis) {
    const key = `stl-room:v1:rate:${digest}:${Math.floor(Date.now() / 60_000)}`;
    count = await redis.eval<[], number>("local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],120) end; return n", [key], []);
  } else {
    // Deliberately simple per-instance protection; serverless instances do not share this map.
    const now = Date.now();
    for (const [key, entry] of rates) if (entry.expires <= now) rates.delete(key);
    const entry = rates.get(digest) || { count: 0, expires: now + 60_000 };
    count = ++entry.count;
    rates.set(digest, entry);
  }
  if (count > 30) throw new ApiError(429, 'アップロードが集中しています。少し待ってください。');
}

export function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (origin && new URL(origin).host !== new URL(request.url).host) throw new ApiError(403, '同じサイトから操作してください。');
}

export async function reserveModel(pathname: string) {
  const path = validatePath(pathname, pathname.toLowerCase().endsWith('.png') ? 'png' : 'model');
  const id = path.slice('uploads/'.length).replace(/\.[^.]+$/,'');
  const count = (await slotPaths()).length;
  if (count >= limits.maxModels) throw new ApiError(409, 'モデルの保存上限に達しました。');
  const redis = optionalRedis();
  if (!redis) return;
  const now = Date.now();
  const result = await redis.eval<(string | number)[], number>(`
    redis.call('ZREMRANGEBYSCORE',KEYS[1],'-inf',ARGV[1]);
    if redis.call('ZSCORE',KEYS[1],ARGV[4]) then return 1 end;
    if redis.call('ZCARD',KEYS[1])+tonumber(ARGV[5])>=tonumber(ARGV[3]) then return 0 end;
    redis.call('ZADD',KEYS[1],ARGV[2],ARGV[4]); return 1;
  `, [PENDING], [now, now + 15 * 60_000, limits.maxModels, id, count]);
  if (!result) throw new ApiError(409, 'モデルの保存上限に達しました。');
}

async function blobBytes(pathname: string, maximum: number): Promise<Uint8Array> {
  requireBlob();
  const result = await get(pathname, { access: 'private', useCache: false });
  if (!result || result.statusCode !== 200) throw new ApiError(404, 'アップロードしたファイルが見つかりません。');
  if (result.blob.size > maximum) { await result.stream.cancel(); throw new ApiError(413, 'ファイルの容量上限を超えています。'); }
  const reader = result.stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximum) { await reader.cancel(); throw new ApiError(413, 'ファイルの容量上限を超えています。'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

async function readManifest(pathname: string): Promise<StoredModel> {
  return JSON.parse(new TextDecoder().decode(await blobBytes(pathname, 8192))) as StoredModel;
}

export async function commitCloudModel(input: ModelCommit): Promise<ModelRecord> {
  const name = validateName(input.name);
  const modelPathname = validatePath(input.modelPathname, 'model');
  const thumbnailPathname = input.thumbnailPathname ? validatePath(input.thumbnailPathname, 'png') : undefined;
  const id = modelPathname.slice('uploads/'.length).replace(/\.[^.]+$/,'');
  const bytes = await blobBytes(modelPathname, limits.maxFileBytes);
  if (thumbnailPathname) validatePng(await blobBytes(thumbnailPathname, MAX_THUMBNAIL_BYTES));
  const {source:{dimensions,triangles},optimized,assembly,format}=await prepareModel(bytes,name);
  const displayPathname = optimized.bytes !== bytes ? `optimized/${id}.stl` : undefined;
  if (displayPathname) {
    try {
      await put(displayPathname, Buffer.from(optimized.bytes), { access: 'private', contentType: 'model/stl', addRandomSuffix: false, allowOverwrite: false });
    } catch (error) {
      // A retry can encounter a derivative already produced from this immutable upload.
      const existing = await get(displayPathname, { access: 'private', useCache: false });
      if (!existing || existing.statusCode !== 200) throw error;
      await existing.stream.cancel();
    }
  }
  const assemblyPathname=assembly?`assemblies/${id}.json`:undefined;
  if(assemblyPathname){
    try { await put(assemblyPathname,JSON.stringify(assembly),{access:'private',contentType:'application/json',addRandomSuffix:false,allowOverwrite:false}); }
    catch(error){const existing=await get(assemblyPathname,{access:'private',useCache:false});if(!existing||existing.statusCode!==200)throw error;await existing.stream.cancel();}
  }
  const record: ModelRecord = {
    id, name, createdAt: new Date().toISOString(), size: bytes.byteLength, dimensions, triangles,
    modelUrl: `/api/assets?id=${id}&kind=model&display=1`,
    originalModelUrl: `/api/assets?id=${id}&kind=original`, optimization: optimized.metadata,
    format, ...(assembly?{assemblyUrl:`/api/assets?id=${id}&kind=assembly`,partCount:assembly.parts.length}:{}),
    ...(thumbnailPathname ? { thumbnailUrl: `/api/assets?id=${id}&kind=thumbnail` } : {}),
  };
  let stored: StoredModel = { ...record, modelPathname, thumbnailPathname, displayPathname, assemblyPathname };
  const options = { access: 'private', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: false } as const;
  try {
    await put(`models/${id}.json`, JSON.stringify(stored), options);
  } catch (error) {
    // Recover a prior successful write after a connection loss; never overwrite metadata.
    try {
      const canonical = await readManifest(`models/${id}.json`);
      if (canonical.id !== id || canonical.modelPathname !== modelPathname) throw error;
      stored = canonical;
    } catch { throw error; }
  }
  // A finite set of create-only Blob paths enforces the quota across Function instances.
  // Every commit scans slots in the same order, so retries for one ID converge on one slot.
  const occupied = new Set(await slotPaths());
  for (let slot = 0; slot < limits.maxModels; slot++) {
    const pathname = `${SLOT_PREFIX}${slot.toString().padStart(5, '0')}.json`;
    if (occupied.has(pathname)) {
      const previous = await readManifest(pathname);
      if (previous.id === id) return publicRecord(previous);
      continue;
    }
    try {
      await put(pathname, JSON.stringify(stored), options);
      const redis = optionalRedis();
      if (redis) await redis.zrem(PENDING, id).catch(() => undefined);
      return publicRecord(stored);
    } catch (error) {
      // Only a confirmed occupied slot is retried; a network failure never loses data.
      let previous: StoredModel;
      try { previous = await readManifest(pathname); } catch { throw error; }
      if (previous.id === id) return publicRecord(previous);
    }
  }
  throw new ApiError(409, 'モデルの保存上限に達しました。');
}

export async function cloudAsset(id: string, kind: 'model' | 'original' | 'thumbnail' | 'assembly'): Promise<Response> {
  const record = await readManifest(`models/${id}.json`);
  const pathname = kind === 'assembly' ? record.assemblyPathname : kind === 'thumbnail' ? record.thumbnailPathname : kind === 'original' ? record.modelPathname : record.displayPathname ?? record.modelPathname;
  if (!pathname) throw new ApiError(404, 'ファイルが見つかりません。');
  const result = await get(pathname, { access: 'private' });
  if (!result || result.statusCode !== 200) throw new ApiError(404, 'ファイルが見つかりません。');
  return new Response(result.stream, { headers: {
    'Content-Type': kind === 'assembly' ? 'application/json' : kind === 'thumbnail' ? 'image/png' : record.format === 'glb' ? 'model/gltf-binary' : kind === 'original' && record.format === 'step' ? 'model/step' : 'model/stl',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, max-age=3600',
  } });
}
