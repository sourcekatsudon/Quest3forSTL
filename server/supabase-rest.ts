import { ApiError } from './validation.js';

export function usesSupabase(): boolean {
  return process.env.STL_STORAGE_BACKEND === 'supabase';
}
function settings() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new ApiError(503, 'Supabaseの接続設定が必要です。');
  const origin = new URL(url);
  if (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(origin.hostname))) throw new ApiError(503, 'SupabaseのURL設定を確認してください。');
  if (origin.pathname !== '/' || origin.username || origin.password || origin.search || origin.hash) throw new ApiError(503, 'SupabaseのURL設定を確認してください。');
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'stl-room-assets';
  if (!/^[a-zA-Z0-9_-]+$/.test(bucket)) throw new ApiError(503, 'Supabaseのバケット設定を確認してください。');
  return { origin: origin.origin, key, bucket };
}
export function storagePath(path: string): string {
  if (!/^(uploads|optimized|assemblies|photos)\/[a-f0-9-]{36}\.(stl|step|stp|glb|png|json|jpg)$/.test(path)) throw new ApiError(400, '保存先が正しくありません。');
  return settings().bucket + '/' + path;
}
async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const { origin, key } = settings();
  const headers = new Headers(init.headers);
  headers.set('apikey', key);
  headers.set('Authorization', 'Bearer ' + key);
  try {
    return await fetch(origin + path, { ...init, headers, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(60000) });
  } catch { throw new ApiError(503, 'Supabaseとの通信に失敗しました。'); }
}
async function checked(response: Response): Promise<Response> {
  if (response.ok) return response;
  let body: {statusCode?: string | number; code?: string; message?: string} = {};
  try { body = await response.json(); } catch {}
  const status = Number(body.statusCode || response.status);
  if (body.code === 'P0001') {
    const mapping: Record<string, [number, string]> = {
      quota: [409, '保存上限に達しました。'],
      conflict: [409, '同じIDで異なるファイルは保存できません。'],
      reservation: [409, 'アップロードの予約が切れました。最初からやり直してください。'],
      deleted: [410, 'このモデルは削除されています。'],
      rate: [429, 'アップロードが集中しています。少し待ってください。'],
    };
    const entry = mapping[body.message || ''];
    if (entry) throw new ApiError(...entry);
  }
  if (status === 404) throw new ApiError(404, 'ファイルが見つかりません。');
  if (status === 413) throw new ApiError(413, '保存先の容量上限を超えています。');
  throw new ApiError(503, 'Supabaseの保存先が利用できません。接続・権限・容量を確認してください。');
}
export async function rpc<T>(name: string, args: object): Promise<T> {
  const response = await checked(await request('/rest/v1/rpc/' + name, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args) }));
  const body = await response.text();
  return (body ? JSON.parse(body) : undefined) as T;
}
export type Entry<T> = {
  id: string; status: 'reserved' | 'published' | 'deleted';
  path: string; bytes: number; thumbnail_path: string | null; thumbnail_bytes: number | null;
  fingerprint: string | null; payload: T | null;
};
export async function entries<T>(kind: 'model' | 'photo', id?: string): Promise<Entry<T>[]> {
  const query = new URLSearchParams({ select: 'id,status,path,bytes,thumbnail_path,thumbnail_bytes,fingerprint,payload', kind: 'eq.' + kind, ...(id ? { id: 'eq.' + id } : { status: 'eq.published', limit: '1000' }) });
  const response = await checked(await request('/rest/v1/stl_room_entries?' + query));
  return response.json() as Promise<Entry<T>[]>;
}
export async function reserve(kind: 'model' | 'photo', id: string, path: string, bytes: number, limit: number, fingerprint: string | null = null): Promise<void> {
  await rpc('stl_room_reserve', { p_kind: kind, p_id: id, p_path: path, p_bytes: bytes, p_limit: limit, p_fingerprint: fingerprint });
}
export async function publish<T>(kind: 'model' | 'photo', id: string, payload: T): Promise<T> {
  return rpc<T>('stl_room_publish', { p_kind: kind, p_id: id, p_payload: payload });
}
function signedUrl(value: unknown, prefix: string): string {
  const { origin } = settings();
  if (typeof value !== 'string' || !value.startsWith(prefix)) throw new ApiError(503, '署名付きURLを発行できません。');
  const url = new URL(origin + '/storage/v1' + value);
  if (url.origin !== origin || !url.searchParams.get('token')) throw new ApiError(503, '署名付きURLを発行できません。');
  return url.href;
}
export async function signUpload(path: string): Promise<string> {
  const response = await checked(await request('/storage/v1/object/upload/sign/' + storagePath(path), {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-upsert': 'false' }, body: '{}',
  }));
  const data = await response.json() as { url?: string };
  return signedUrl(data.url, '/object/upload/sign/' + storagePath(path) + '?');
}
export async function bytes(path: string, maximum: number): Promise<Uint8Array> {
  const response = await checked(await request('/storage/v1/object/authenticated/' + storagePath(path)));
  const size = Number(response.headers.get('Content-Length') || 0);
  if (size > maximum) { await response.body?.cancel(); throw new ApiError(413, 'ファイルの容量上限を超えています。'); }
  const reader = response.body?.getReader();
  if (!reader) throw new ApiError(503, '保存ファイルを読み込めません。');
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximum) { await reader.cancel(); throw new ApiError(413, 'ファイルの容量上限を超えています。'); }
    chunks.push(value);
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}
/** Create-only upload. A lost response can be retried, but conflicting bytes cannot overwrite the object. */
export async function writeImmutable(path: string, data: Uint8Array, contentType: string): Promise<void> {
  const response = await request('/storage/v1/object/' + storagePath(path), {
    method: 'POST', headers: { 'Content-Type': contentType, 'x-upsert': 'false', 'Cache-Control': 'max-age=3600' }, body: Buffer.from(data),
  });
  if (response.ok) return;
  try {
    const saved = await bytes(path, data.byteLength);
    if (Buffer.from(saved).equals(Buffer.from(data))) return;
    throw new ApiError(409, '同じIDのファイルが既に存在します。');
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) throw error;
    await checked(response);
  }
}
export async function removeObjects(paths: string[]): Promise<void> {
  if (!paths.length) return;
  for (const path of paths) storagePath(path);
  await checked(await request('/storage/v1/object/' + settings().bucket, {
    method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: [...new Set(paths)] }),
  }));
}
export async function assetRedirect(path: string): Promise<Response> {
  const result = await (await checked(await request('/storage/v1/object/sign/' + storagePath(path), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn: 900 }),
  }))).json() as { signedURL?: string };
  return new Response(null, { status: 302, headers: { Location: signedUrl(result.signedURL, '/object/sign/' + storagePath(path) + '?'), 'Cache-Control': 'private, max-age=120', 'Referrer-Policy': 'no-referrer' } });
}
