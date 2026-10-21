import { cloudLibrary, commitCloudModel, rateLimit, sameOrigin } from '../server/cloud-store.js';
import { apiError, smallJson } from '../server/http.js';
import type { ModelCommit } from '../shared/models';

async function handler(request: Request): Promise<Response> {
  try {
    if (request.method === 'GET') return Response.json(await cloudLibrary(), { headers: { 'Cache-Control': 'no-store' } });
    if (request.method === 'POST') {
      sameOrigin(request);
      await rateLimit(request);
      return Response.json({ model: await commitCloudModel(await smallJson(request) as ModelCommit) }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
    }
    return new Response(null, { status: 405, headers: { Allow: 'GET, POST' } });
  } catch (error) { return apiError(error); }
}

export const GET = handler;
export const POST = handler;
