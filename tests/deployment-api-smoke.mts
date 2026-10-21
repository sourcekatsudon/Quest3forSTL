import { loadEnvFile } from 'node:process';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { del, get, list } from '@vercel/blob';
import { put as clientPut } from '@vercel/blob/client';

try { loadEnvFile('.env.local'); } catch { /* Existing environment is sufficient. */ }
const origin = new URL(process.argv[2] || '').origin;
if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error('The private test cleanup token is required.');
const id = randomUUID();
const paths = { model: `uploads/${id}.stl`, thumbnail: `uploads/${id}.png` };
const created = new Set([paths.model, paths.thumbnail, `models/${id}.json`]);
const results: Record<string, unknown> = { origin, testedAt: new Date().toISOString(), passed: false, testModelBytes: 5_000_084, checks: [] };
const checks = results.checks as Record<string, unknown>[];
const start = Date.now();
const triangles = 100_000;
const bytes = new Uint8Array(84 + triangles * 50);
const view = new DataView(bytes.buffer);
view.setUint32(80, triangles, true);
for (let triangle = 0; triangle < triangles; triangle++) {
  [0, 0, 0, 10, 0, 0, 0, 20, 30].forEach((value, vertex) => view.setFloat32(96 + triangle * 50 + vertex * 4, value, true));
}
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aNTsAAAAASUVORK5CYII=', 'base64');

async function upload(pathname: string, data: Uint8Array, contentType: string) {
  const response = await fetch(`${origin}/api/upload`, {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'blob.generate-client-token', payload: { pathname, multipart: false, clientPayload: null } }),
  });
  assert.equal(response.status, 200, 'Deployed upload token endpoint');
  const payload = await response.json() as { clientToken?: string };
  assert.ok(payload.clientToken && !payload.clientToken.includes(process.env.BLOB_READ_WRITE_TOKEN!));
  await clientPut(pathname, new Blob([data]), { access: 'private', contentType, token: payload.clientToken });
}

try {
  const initial = await fetch(`${origin}/api/models`, { cache: 'no-store' });
  assert.equal(initial.status, 200, 'Initial deployed library request');
  const initialLibrary = await initial.json() as { storage: string; models: unknown[] };
  assert.equal(initialLibrary.storage, 'cloud');
  checks.push({ check: 'GET /api/models', status: initial.status, storage: initialLibrary.storage });
  await upload(paths.model, bytes, 'model/stl');
  await upload(paths.thumbnail, png, 'image/png');
  checks.push({ check: 'Scoped direct private uploads', modelBytes: bytes.byteLength, thumbnailBytes: png.byteLength });
  const input = { name: `deployment-smoke-${id}.stl`, modelPathname: paths.model, thumbnailPathname: paths.thumbnail };
  const commit = () => fetch(`${origin}/api/models`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
  const response = await commit();
  assert.equal(response.status, 201, 'Deployed model commit');
  const { model } = await response.json() as { model: { id: string; dimensions: unknown; triangles: number; modelUrl: string; thumbnailUrl: string } };
  assert.equal(model.id, id);
  assert.deepEqual(model.dimensions, { width: 10, depth: 20, height: 30 });
  assert.equal(model.triangles, triangles);
  checks.push({ check: 'POST /api/models validates and persists metadata', status: response.status, dimensions: model.dimensions, triangles: model.triangles });
  const retry = await commit();
  assert.equal(retry.status, 201);
  assert.equal((await retry.json() as { model: { id: string } }).model.id, id);
  checks.push({ check: 'Commit retry preserves model ID', status: retry.status });
  const streamed = await fetch(new URL(model.modelUrl, origin));
  assert.equal(streamed.status, 200, 'Deployed >4.5 MB streamed model asset');
  const received = new Uint8Array(await streamed.arrayBuffer());
  assert.equal(received.byteLength, bytes.byteLength);
  const expectedSha = createHash('sha256').update(bytes).digest('hex');
  assert.equal(createHash('sha256').update(received).digest('hex'), expectedSha);
  checks.push({ check: 'GET /api/assets model exceeds ordinary 4.5 MB Function response limit', status: streamed.status, bytes: received.byteLength, sha256: expectedSha, contentType: streamed.headers.get('content-type') });
  const thumbnail = await fetch(new URL(model.thumbnailUrl, origin));
  assert.equal(thumbnail.status, 200);
  assert.deepEqual(Buffer.from(await thumbnail.arrayBuffer()), png);
  checks.push({ check: 'GET /api/assets persistent thumbnail', status: thumbnail.status, bytes: png.byteLength });
  const reloaded = await fetch(`${origin}/api/models`, { cache: 'no-store' });
  assert.equal(reloaded.status, 200);
  const library = await reloaded.json() as { models: { id: string }[] };
  assert.equal(library.models.filter((entry) => entry.id === id).length, 1);
  checks.push({ check: 'Fresh HTTP library request retains exactly one committed model', status: reloaded.status });
  const foreign = await fetch(`${origin}/api/models`, { method: 'POST', headers: { Origin: 'https://foreign.invalid', 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(foreign.status, 403);
  checks.push({ check: 'Foreign-origin write rejected', status: foreign.status });
  results.passed = true;
} catch (error) {
  results.failure = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  try {
    let cursor: string | undefined;
    do {
      const page = await list({ prefix: 'library-slots/', cursor, limit: 1000 });
      for (const blob of page.blobs) {
        const result = await get(blob.pathname, { access: 'private', useCache: false });
        if (result?.statusCode === 200 && ((await new Response(result.stream).json()) as { id?: string }).id === id) created.add(blob.pathname);
      }
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    await del([...created]);
    results.cleanup = { deletedOnlySyntheticPaths: true, count: created.size };
  } catch (error) {
    results.cleanup = { failed: true, message: error instanceof Error ? error.message : String(error) };
    process.exitCode = 1;
  }
  results.durationMs = Date.now() - start;
  await mkdir('artifacts', { recursive: true });
  await writeFile('artifacts/deployment-api-results.json', JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
}
