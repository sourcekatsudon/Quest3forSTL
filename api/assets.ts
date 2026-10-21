import { cloudAsset } from '../server/cloud-store.js';
import { apiError } from '../server/http.js';
import { ApiError, idPattern } from '../server/validation.js';

// Private Blob get() is delivered as a streaming Response, including files > 4.5 MB.
export const config = { supportsResponseStreaming: true };

export async function GET(request: Request): Promise<Response> {
  if (request.method !== 'GET') return new Response(null, { status: 405 });
  try {
    const url = new URL(request.url);
    const id = url.searchParams.get('id') || '';
    const kind = url.searchParams.get('kind');
    if (!idPattern.test(id) || (kind !== 'model' && kind !== 'original' && kind !== 'thumbnail' && kind !== 'assembly')) throw new ApiError(400, 'ファイル指定が正しくありません。');
    return await cloudAsset(id, kind);
  } catch (error) { return apiError(error); }
}
