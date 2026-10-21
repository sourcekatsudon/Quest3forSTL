import { cloudPhotoAsset, listCloudPhotos, photoId, saveCloudPhoto } from '../server/photos.js';
import { rateLimit, sameOrigin } from '../server/cloud-store.js';
import { apiError } from '../server/http.js';
import { ApiError } from '../server/validation.js';
import { photoLimits } from '../shared/photos.js';

export const config = { supportsResponseStreaming: true };
async function handler(request: Request): Promise<Response> {
 try {
  const url = new URL(request.url);
  if (request.method === 'GET') return url.searchParams.has('id') ? await cloudPhotoAsset(photoId(url.searchParams.get('id'))) : Response.json({ photos: await listCloudPhotos(), limits: photoLimits }, { headers: { 'Cache-Control': 'no-store' } });
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'GET, POST' } });
  sameOrigin(request); await rateLimit(request);
  const id = photoId(url.searchParams.get('id'));
  if (Number(request.headers.get('content-length') || 0) > photoLimits.maxBytes) throw new ApiError(413, '写真は3 MB以下で保存してください。');
  const reader = request.body?.getReader(); if (!reader) throw new ApiError(400, '写真がありません。');
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > photoLimits.maxBytes) { await reader.cancel(); throw new ApiError(413, '写真は3 MB以下で保存してください。'); } chunks.push(value); }
  return Response.json({ photo: await saveCloudPhoto(id, Buffer.concat(chunks)) }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
 } catch (error) { return apiError(error); }
}
export const GET = handler;
export const POST = handler;
