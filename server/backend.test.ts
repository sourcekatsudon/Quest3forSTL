import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalStore } from './local-store';
import { ApiError, inspectStl, limits, validateName, validatePath, validatePng } from './validation';
import { smallJson } from './http';
import { GET as assetGet } from '../api/assets';
import { GET as libraryGet } from '../api/models';
import { rateLimit, sameOrigin } from './cloud-store';

function binaryStl(): Uint8Array {
  const bytes = new Uint8Array(84 + 50);
  const view = new DataView(bytes.buffer);
  view.setUint32(80, 1, true);
  const values = [0, 0, 0, 280, 0, 0, 0, 160, 85.5];
  values.forEach((value, i) => view.setFloat32(96 + i * 4, value, true));
  return bytes;
}
const ascii = new TextEncoder().encode(`solid unit\nfacet normal 0 0 1\nouter loop\nvertex -1 -2 -3\nvertex 279 -2 -3\nvertex -1 158 82.5\nendloop\nendfacet\nendsolid unit`);
const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 1, 0, 0, 0, 1, 0]);

test('binary and ASCII preserve CAD X/Y/Z dimensions in mm', () => {
  for (const bytes of [binaryStl(), ascii]) assert.deepEqual(inspectStl(bytes), { dimensions: { width: 280, depth: 160, height: 85.5 }, triangles: 1 });
});

test('binary header beginning solid is still detected as binary', () => {
  const bytes = binaryStl();
  bytes.set(new TextEncoder().encode('solid binary'));
  assert.equal(inspectStl(bytes).triangles, 1);
});

test('rejects corrupted, non-finite, empty and oversize geometry', () => {
  assert.throws(() => inspectStl(new Uint8Array()), ApiError);
  assert.throws(() => inspectStl(new TextEncoder().encode('solid empty\nendsolid empty')), ApiError);
  assert.throws(() => inspectStl(binaryStl().slice(0, -1)));
  const invalid = binaryStl();
  new DataView(invalid.buffer).setFloat32(96, Infinity, true);
  assert.throws(() => inspectStl(invalid), ApiError);
  assert.throws(() => inspectStl(new Uint8Array(limits.maxFileBytes + 1)), ApiError);
  assert.throws(() => inspectStl(new TextEncoder().encode(new TextDecoder().decode(ascii).replace('vertex -1 158 82.5', 'vertex NaN 158 82.5'))), ApiError);
});

test('rejects unsafe paths, non-STL names, and invalid thumbnail formats', () => {
  for (const path of ['../token.stl', 'uploads/../file.stl', 'https://evil.com/file.stl', 'uploads/a.stl']) assert.throws(() => validatePath(path, 'stl'), ApiError);
  for (const name of ['thing.exe', '../thing.stl', 'a\n.stl']) assert.throws(() => validateName(name), ApiError);
  validateName('日本語 STL.stl');
  validatePng(png);
  assert.throws(() => validatePng(ascii), ApiError);
});

test('disk library persists across instances, keeps duplicate names, and preserves records under concurrency', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'stl-room-test-'));
  try {
    const store = new LocalStore(directory);
    const upload = await store.upload(binaryStl(), 'model', '同名.stl');
    const thumbnail = await store.upload(png, 'thumbnail', 'thumbnail.png');
    const models = await Promise.all(Array.from({ length: 5 }, () => store.commit({ name: '同名.stl', modelPathname: upload.pathname, thumbnailPathname: thumbnail.pathname })));
    assert.equal(new Set(models.map((model) => model.id)).size, 5);
    const reloaded = new LocalStore(directory);
    const list = await reloaded.list();
    assert.equal(list.length, 5);
    assert.ok(list.every((model) => model.name === '同名.stl' && model.thumbnailUrl && !('modelPathname' in model)));
    assert.deepEqual(new Uint8Array(await reloaded.asset(models[0].id, 'model')), binaryStl());
    assert.deepEqual(new Uint8Array(await reloaded.asset(models[0].id, 'thumbnail')), png);
    await assert.rejects(() => reloaded.commit({ name: 'bad.stl', modelPathname: '../unsafe.stl' }), ApiError);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('concurrent local commits enforce model quota atomically', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'stl-room-quota-'));
  const previousLimit = limits.maxModels;
  try {
    limits.maxModels = 2;
    const store = new LocalStore(directory);
    const upload = await store.upload(binaryStl(), 'model', 'test.stl');
    const commits = await Promise.allSettled(Array.from({ length: 5 }, () => store.commit({ name: 'test.stl', modelPathname: upload.pathname })));
    assert.equal(commits.filter((commit) => commit.status === 'fulfilled').length, 2);
    assert.equal((await store.list()).length, 2);
  } finally { limits.maxModels = previousLimit; await rm(directory, { recursive: true, force: true }); }
});

test('metadata API body is bounded and rejects non-object JSON', async () => {
  assert.deepEqual(await smallJson(new Request('https://example.test', { method: 'POST', body: '{"name":"a"}' })), { name: 'a' });
  for (const body of ['[]', 'null', '{invalid', 'x'.repeat(9000)]) await assert.rejects(() => smallJson(new Request('https://example.test', { method: 'POST', body })));
});

test('cloud config errors are explicit and asset paths cannot access arbitrary blobs', async () => {
  const invalid = await assetGet(new Request('https://example.test/api/assets?id=../../secret&kind=model'));
  assert.equal(invalid.status, 400);
  const previous = process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.BLOB_READ_WRITE_TOKEN;
  try {
    const result = await libraryGet(new Request('https://example.test/api/models'));
    assert.equal(result.status, 503);
    assert.match(await result.text(), /接続設定/);
  } finally { if (previous) process.env.BLOB_READ_WRITE_TOKEN = previous; }
});

test('Blob-only fallback limits writes per IP per instance and rejects foreign origins', async () => {
  const keys = ['BLOB_READ_WRITE_TOKEN', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'] as const;
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  process.env.BLOB_READ_WRITE_TOKEN = 'test-placeholder';
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  try {
    const request = new Request('https://example.test/api/upload', { headers: { 'x-forwarded-for': '192.0.2.123' } });
    for (let i = 0; i < 30; i++) await rateLimit(request);
    await assert.rejects(() => rateLimit(request), (error) => error instanceof ApiError && error.status === 429);
    await rateLimit(new Request('https://example.test/api/upload', { headers: { 'x-forwarded-for': '192.0.2.124' } }));
    assert.throws(() => sameOrigin(new Request('https://example.test/api/upload', { headers: { origin: 'https://foreign.test' } })), ApiError);
    sameOrigin(new Request('https://example.test/api/upload', { headers: { origin: 'https://example.test' } }));
  } finally {
    for (const key of keys) { const value = previous.get(key); if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});
