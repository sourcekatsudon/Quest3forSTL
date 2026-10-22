import { cloudLibrary, commitCloudModel, deleteCloudModel, rateLimit, sameOrigin } from '../server/cloud-store.js';
import { apiError, smallJson } from '../server/http.js';
import type { ModelCommit } from '../shared/models';
import { ApiError, idPattern } from '../server/validation.js';
import { cachedCatalog, invalidateCatalog } from '../server/catalog-cache.js';

async function handler(request: Request): Promise<Response> {
  try {
    if (request.method === 'GET') return Response.json(await cachedCatalog('models',cloudLibrary), { headers: { 'Cache-Control': 'no-store' } });
    if (request.method === 'POST') {
      sameOrigin(request);
      await rateLimit(request);
      const model=await commitCloudModel(await smallJson(request) as ModelCommit);
      await invalidateCatalog('models');
      return Response.json({ model }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
    }
    if (request.method === 'DELETE') {
      sameOrigin(request);
      const id = new URL(request.url).searchParams.get('id') || '';
      if (!idPattern.test(id)) throw new ApiError(400, 'モデルの指定が正しくありません。');
      await rateLimit(request);
      await deleteCloudModel(id);
      await invalidateCatalog('models');
      return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
    }
    return new Response(null, { status: 405, headers: { Allow: 'GET, POST, DELETE' } });
  } catch (error) { return apiError(error); }
}

export const GET = handler;
export const POST = handler;
export const DELETE = handler;
