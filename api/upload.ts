import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { rateLimit, reserveModel, sameOrigin } from '../server/cloud-store.js';
import { apiError, smallJson } from '../server/http.js';
import { ApiError, limits, MAX_THUMBNAIL_BYTES, uploadPattern, validatePath } from '../server/validation.js';

export async function POST(request: Request): Promise<Response> {
  if (request.method !== 'POST') return new Response(null, { status: 405 });
  try {
    const body = await smallJson(request) as HandleUploadBody;
    const response = await handleUpload({
      request, body,
      onBeforeGenerateToken: async (pathname) => {
        sameOrigin(request);
        await rateLimit(request);
        if (!uploadPattern.test(pathname)) throw new ApiError(400, '保存先が正しくありません。');
        const thumbnail = pathname.toLowerCase().endsWith('.png');
        validatePath(pathname, thumbnail ? 'png' : 'model');
        // Both files share a UUID; even thumbnail-only requests consume a quota slot.
        await reserveModel(pathname);
        return {
          allowedContentTypes: thumbnail ? ['image/png'] : ['model/stl', 'model/step', 'model/gltf-binary', 'application/octet-stream', 'application/sla', 'application/vnd.ms-pki.stl'],
          maximumSizeInBytes: thumbnail ? MAX_THUMBNAIL_BYTES : limits.maxFileBytes,
          validUntil: Date.now() + 15 * 60_000,
          addRandomSuffix: false,
          allowOverwrite: false,
        };
      },
      // Publication uses /api/models after independent byte validation, so no
      // asynchronous upload-completed webhook or external callback is needed.
    });
    return Response.json(response, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return apiError(error); }
}
