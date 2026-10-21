/** Opt-in real private Blob integration test. Only deletes UUID-tagged test data. */
import { loadEnvFile } from 'node:process';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { del, get, list, put } from '@vercel/blob';
import { put as clientPut } from '@vercel/blob/client';
import { cloudAsset, cloudLibrary, commitCloudModel } from './cloud-store';
import { POST as tokenPost } from '../api/upload';

try { loadEnvFile('.env.local'); } catch { /* Environment may already be set. */ }
if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error('Set BLOB_READ_WRITE_TOKEN before running this opt-in test.');
// Smoke testing the supported Blob-only path must not depend on an optional Redis account.
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;
const id = randomUUID();
const modelPathname = `uploads/${id}.stl`;
const thumbnailPathname = `uploads/${id}.png`;
const manifestPath = `models/${id}.json`;
const racePath = `smoke-tests/${id}/race.json`;
const created = new Set([modelPathname, thumbnailPathname, manifestPath, racePath]);
// Slightly exceed the ordinary Vercel Function 4.5 MB response-body limit.
const triangleCount = 100_000;
const bytes = new Uint8Array(84 + triangleCount * 50);
const view = new DataView(bytes.buffer);
view.setUint32(80, triangleCount, true);
for (let triangle = 0; triangle < triangleCount; triangle++) {
  [0, 0, 0, 10, 0, 0, 0, 20, 30].forEach((v, i) => view.setFloat32(96 + triangle * 50 + i * 4, v, true));
}
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aNTsAAAAASUVORK5CYII=', 'base64');

try {
  const tokenResponse = await tokenPost(new Request('https://stl-room-smoke.invalid/api/upload', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'blob.generate-client-token', payload: { pathname: modelPathname, clientPayload: null, multipart: false } }),
  }));
  assert.equal(tokenResponse.status, 200, `Token endpoint returned ${tokenResponse.status}`);
  const tokenBody = await tokenResponse.json() as { clientToken: string };
  assert.ok(tokenBody.clientToken && !tokenBody.clientToken.includes(process.env.BLOB_READ_WRITE_TOKEN!));
  await clientPut(modelPathname, new Blob([bytes]), { access: 'private', contentType: 'model/stl', token: tokenBody.clientToken });
  await put(thumbnailPathname, png, { access: 'private', contentType: 'image/png', addRandomSuffix: false, allowOverwrite: false });
  const input = { name: `smoke-${id}.stl`, modelPathname, thumbnailPathname };
  const [first, retried] = await Promise.all([commitCloudModel(input), commitCloudModel(input)]);
  assert.equal(first.id, id);
  assert.deepEqual(first, retried);
  assert.deepEqual(first.dimensions, { width: 10, depth: 20, height: 30 });
  const library = await cloudLibrary();
  assert.equal(library.models.filter((model) => model.id === id).length, 1);
  const asset = await cloudAsset(id, 'model');
  assert.equal(asset.status, 200);
  assert.deepEqual(new Uint8Array(await asset.arrayBuffer()), bytes);
  const thumbnail = await cloudAsset(id, 'thumbnail');
  assert.equal(thumbnail.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await thumbnail.arrayBuffer()), png);
  const race = await Promise.allSettled([0, 1].map((winner) => put(racePath, JSON.stringify({ winner }), { access: 'private', addRandomSuffix: false, allowOverwrite: false })));
  assert.equal(race.filter((result) => result.status === 'fulfilled').length, 1, 'Create-only Blob writes must have one winner');
  console.log('Private Blob integration passed: scoped direct upload, concurrent idempotent commit, list, dimensions, 5,000,084-byte streamed model + thumbnail, atomic create-only conflict.');
} finally {
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: 'library-slots/', cursor, limit: 1000 });
    for (const blob of page.blobs) {
      const result = await get(blob.pathname, { access: 'private', useCache: false });
      if (result?.statusCode === 200) {
        const stored = await new Response(result.stream).json() as { id?: string };
        if (stored.id === id) created.add(blob.pathname);
      }
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  await del([...created]);
  console.log('Removed all synthetic smoke-test objects.');
}
