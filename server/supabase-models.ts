import { createHash } from 'node:crypto';
import { prepareModel } from './prepare-model.js';
import { ApiError, limits, MAX_THUMBNAIL_BYTES, validateName, validatePath, validatePng } from './validation.js';
import type { LibraryResponse, ModelCommit, ModelRecord } from '../shared/models';
import { assetRedirect, bytes, entries, publish, removeObjects, reserve, rpc, signUpload, writeImmutable } from './supabase-rest.js';

interface StoredModel extends ModelRecord { modelPathname: string; thumbnailPathname?: string; displayPathname?: string; assemblyPathname?: string }
function publicRecord(stored: StoredModel): ModelRecord {
  const { modelPathname: _model, thumbnailPathname: _thumb, displayPathname: _display, assemblyPathname: _assembly, ...result } = stored;
  return result;
}
function uploadId(path: string): string {
  const id = path.slice('uploads/'.length).replace(/\.[^.]+$/, '');
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)) throw new ApiError(400, 'ファイルの指定が正しくありません。');
  return id;
}
export async function supabaseRateLimit(request: Request): Promise<void> {
  const ip = (request.headers.get('x-forwarded-for') || 'unknown').split(',')[0].trim();
  await rpc('stl_room_rate', { p_ip: createHash('sha256').update(ip).digest('hex') });
}
export async function supabaseUpload(input: { pathname?: unknown; size?: unknown }): Promise<{ pathname: string; url: string }> {
  const thumbnail = typeof input.pathname === 'string' && input.pathname.endsWith('.png');
  const path = validatePath(input.pathname, thumbnail ? 'png' : 'model');
  const id = uploadId(path);
  const size = input.size;
  if (typeof size !== 'number' || !Number.isSafeInteger(size) || size <= 0 || size > (thumbnail ? MAX_THUMBNAIL_BYTES : limits.maxFileBytes)) throw new ApiError(413, 'ファイルの容量上限を超えています。');
  await reserve('model', id, path, size, limits.maxModels);
  return { pathname: path, url: await signUpload(path) };
}
export async function supabaseLibrary(): Promise<LibraryResponse> {
  const models = (await entries<StoredModel>('model')).map(row => publicRecord(row.payload!));
  return { models: models.sort((a,b) => b.createdAt.localeCompare(a.createdAt)), storage: 'cloud', uploadBackend: 'supabase', limits };
}
export async function supabaseCommit(input: ModelCommit): Promise<ModelRecord> {
  const name = validateName(input.name);
  const path = validatePath(input.modelPathname, 'model');
  const id = uploadId(path);
  if (name.split('.').at(-1)?.toLowerCase() !== path.split('.').at(-1)) throw new ApiError(400, 'ファイル形式が一致しません。');
  const thumbnailPathname = input.thumbnailPathname ? validatePath(input.thumbnailPathname, 'png') : undefined;
  if (thumbnailPathname && uploadId(thumbnailPathname) !== id) throw new ApiError(400, 'サムネイルのIDが一致しません。');
  const row = (await entries<StoredModel>('model', id))[0];
  if (row?.status === 'deleted') throw new ApiError(410, 'このモデルは削除されています。');
  if (!row || row.path !== path || (row.thumbnail_path ?? undefined) !== thumbnailPathname) throw new ApiError(409, 'アップロード予約が見つかりません。');
  if (row.status === 'published') {
    if (row.payload!.name !== name) throw new ApiError(409, '同じIDで異なる名前は保存できません。');
    return publicRecord(row.payload!);
  }
  const sourceBytes = await bytes(path, limits.maxFileBytes);
  if (sourceBytes.byteLength !== row.bytes) throw new ApiError(422, 'アップロードサイズが一致しません。');
  if (thumbnailPathname) {
    const thumbnail = await bytes(thumbnailPathname, MAX_THUMBNAIL_BYTES);
    if (thumbnail.byteLength !== row.thumbnail_bytes) throw new ApiError(422, 'サムネイルのサイズが一致しません。');
    validatePng(thumbnail);
  }
  const {source:{dimensions,triangles},optimized,assembly,format} = await prepareModel(sourceBytes,name);
  const displayPathname = optimized.bytes !== sourceBytes ? 'optimized/' + id + '.stl' : undefined;
  const assemblyPathname = assembly ? 'assemblies/' + id + '.json' : undefined;
  if (displayPathname) await writeImmutable(displayPathname, optimized.bytes, 'model/stl');
  if (assemblyPathname) await writeImmutable(assemblyPathname, new TextEncoder().encode(JSON.stringify(assembly)), 'application/json');
  const url = '/api/assets?id=' + id + '&kind=';
  const stored: StoredModel = {
    id, name, createdAt: new Date().toISOString(), size: sourceBytes.byteLength, dimensions, triangles,
    modelUrl: url + 'model&display=1', originalModelUrl: url + 'original', optimization: optimized.metadata, format,
    ...(assembly ? { assemblyUrl: url + 'assembly', partCount: assembly.parts.length } : {}),
    ...(thumbnailPathname ? { thumbnailUrl: url + 'thumbnail' } : {}),
    modelPathname: path, thumbnailPathname, displayPathname, assemblyPathname,
  };
  const saved = await publish('model',id,stored);
  if (saved.name !== name) throw new ApiError(409, '同じIDで異なる名前は保存できません。');
  return publicRecord(saved);
}
export async function supabaseAsset(id: string, kind: 'model'|'original'|'thumbnail'|'assembly'): Promise<Response> {
  const row = (await entries<StoredModel>('model', id))[0];
  if (row?.status === 'deleted') throw new ApiError(410, 'このモデルは削除されています。');
  if (row?.status !== 'published' || !row.payload) throw new ApiError(404, 'モデルが見つかりません。');
  const record = row.payload;
  const path = kind === 'assembly' ? record.assemblyPathname : kind === 'thumbnail' ? record.thumbnailPathname : kind === 'original' ? record.modelPathname : record.displayPathname ?? record.modelPathname;
  if (!path) throw new ApiError(404, 'ファイルが見つかりません。');
  return assetRedirect(path);
}
export async function supabaseDelete(id: string): Promise<void> {
  const record = await rpc<StoredModel | null>('stl_room_delete', { p_id: id });
  if (!record) return;
  // New uploads are isolated by UUID, so no other model can reference these paths.
  await removeObjects([record.modelPathname, record.thumbnailPathname, record.displayPathname, record.assemblyPathname].filter((path): path is string => Boolean(path)));
}
