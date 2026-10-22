import { ApiError } from './validation.js';
import { storageError } from './catalog-cache.js';

export function apiError(error: unknown): Response {
  error=storageError(error)??error;
  const status = error instanceof ApiError ? error.status : error instanceof SyntaxError || error instanceof TypeError ? 400 : 500;
  if (status === 500) console.error('STL ROOM API:', error instanceof Error ? error.message.replace(/vercel_blob_rw_[\w_-]+/g, '[redacted]') : 'Unexpected error');
  return Response.json({ error: error instanceof ApiError ? error.message : status === 400 ? '送信内容を確認してください。' : 'クラウドとの通信に失敗しました。もう一度お試しください。' }, { status, headers: { 'Cache-Control': 'no-store',...(status===503?{'Retry-After':'60'}:{}) } });
}

export async function smallJson(request: Request): Promise<unknown> {
  if (Number(request.headers.get('content-length') || 0) > 8192) throw new ApiError(413, '送信データが大きすぎます。');
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, '送信内容を確認してください。');
  let text = '';
  let size = 0;
  const decoder = new TextDecoder();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 8192) { await reader.cancel(); throw new ApiError(413, '送信データが大きすぎます。'); }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  const result: unknown = JSON.parse(text);
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new ApiError(400, '送信内容を確認してください。');
  return result;
}
