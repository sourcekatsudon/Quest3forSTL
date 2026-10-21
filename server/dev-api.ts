import type { Plugin } from 'vite';
import { LocalStore } from './local-store';
import { ApiError, idPattern, limits, MAX_THUMBNAIL_BYTES } from './validation';
import type { ModelCommit } from '../shared/models';
import { LocalPhotoStore, photoId } from './photos';
import { photoLimits } from '../shared/photos';

export function stlRoomApi(): Plugin {
  const store = new LocalStore();
  const photos = new LocalPhotoStore();
  const rates = new Map<string, { count: number; expires: number }>();
  return {
    name: 'stl-room-local-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url || '/', 'http://localhost');
        if (!['/api/models', '/api/local-upload', '/api/assets', '/api/photos'].includes(url.pathname)) return next();
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        const json = (body: unknown, status = 200) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(body)); };
        try {
          if (req.method === 'GET' && url.pathname === '/api/photos') {
            if (!url.searchParams.has('id')) return json({ photos: await photos.list(), limits: photoLimits });
            const bytes = await photos.asset(photoId(url.searchParams.get('id')));
            res.setHeader('Content-Type', 'image/jpeg'); res.end(bytes); return;
          }
          if (req.method === 'GET' && url.pathname === '/api/models') return json({ models: await store.list(), storage: 'local', limits });
          if (req.method === 'GET' && url.pathname === '/api/assets') {
            const id = url.searchParams.get('id') || '';
            const kind = url.searchParams.get('kind') || '';
            if (!idPattern.test(id) || !['model', 'original', 'thumbnail', 'assembly'].includes(kind)) throw new ApiError(400, 'ファイル指定が正しくありません。');
            const bytes = await store.asset(id, kind);
            res.setHeader('Content-Type', kind === 'assembly' ? 'application/json' : kind === 'thumbnail' ? 'image/png' : kind === 'original' ? 'application/octet-stream' : 'model/stl');
            res.end(bytes);
            return;
          }
          if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); throw new ApiError(405, 'この操作には対応していません。'); }
          const origin = req.headers.origin;
          // HTTPS Vite negotiates HTTP/2, which supplies :authority instead of Host.
          const authority = req.headers.host || req.headers[':authority'];
          const requestHost = Array.isArray(authority) ? authority[0] : authority;
          if (origin && new URL(origin).host !== requestHost) {
            const source = new URL(origin);
            if (!requestHost) throw new ApiError(400, '接続先を確認してください。');
            const target = new URL(`http://${requestHost}`);
            const loopback = new Set(['localhost', '127.0.0.1', '[::1]']);
            if (!(loopback.has(source.hostname) && loopback.has(target.hostname) && source.port === target.port)) throw new ApiError(403, '同じサイトから操作してください。');
          }
          const key = req.socket.remoteAddress || 'local';
          const now = Date.now();
          for (const [ip, value] of rates) if (value.expires <= now) rates.delete(ip);
          const rate = rates.get(key) || { count: 0, expires: now + 60_000 };
          if (++rate.count > 30) throw new ApiError(429, '少し待ってからお試しください。');
          rates.set(key, rate);
          const maximum = url.pathname === '/api/photos' ? photoLimits.maxBytes : url.pathname === '/api/models' ? 4096 : url.searchParams.get('kind') === 'thumbnail' ? MAX_THUMBNAIL_BYTES : limits.maxFileBytes;
          if (Number(req.headers['content-length'] || 0) > maximum) throw new ApiError(413, 'ファイルの容量上限を超えています。');
          const chunks: Buffer[] = [];
          let size = 0;
          for await (const chunk of req) {
            size += chunk.length;
            if (size > maximum) throw new ApiError(413, 'ファイルの容量上限を超えています。');
            chunks.push(Buffer.from(chunk));
          }
          const bytes = Buffer.concat(chunks);
          if (url.pathname === '/api/photos') return json({ photo: await photos.save(photoId(url.searchParams.get('id')), bytes) }, 201);
          if (url.pathname === '/api/local-upload') return json(await store.upload(bytes, url.searchParams.get('kind') || 'model', url.searchParams.get('name') || 'model.stl'), 201);
          if (url.pathname === '/api/models') return json({ model: await store.commit(JSON.parse(bytes.toString()) as ModelCommit) }, 201);
          throw new ApiError(404, 'APIが見つかりません。');
        } catch (error) {
          const missing = (error as NodeJS.ErrnoException).code === 'ENOENT';
          const status = error instanceof ApiError ? error.status : error instanceof SyntaxError || error instanceof TypeError ? 400 : missing ? 404 : 500;
          json({ error: status < 500 ? error instanceof ApiError ? error.message : missing ? 'ファイルが見つかりません。' : '送信内容を確認してください。' : '保存に失敗しました。もう一度お試しください。' }, status);
        }
      });
    },
  };
}
