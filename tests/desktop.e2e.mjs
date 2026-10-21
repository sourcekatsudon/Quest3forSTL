import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

/** Run against IWSDK's existing managed window:
 * npx @iwsdk/cli dev up --allow-browser-automation
 * npx @iwsdk/cli browser run tests/desktop.e2e.mjs --timeout 90000
 */
export default async function run({ page, frame, context, workspaceRoot }) {
  const app = frame ?? page;
  const messages = [];
  const suffix = Date.now();
  const firstName = `精密ブラケット_${suffix}.stl`;
  const secondName = `小型パーツ_${suffix}.stl`;
  const payload = (name, width, depth, height) => ({ name, mimeType: 'model/stl', buffer: Buffer.from(boxSTL(width, depth, height)) });
  const input = app.locator('.file-input');
  await app.locator('.brand').waitFor({ state: 'visible', timeout: 30000 });
  await app.evaluate(({ name, source }) => {
    const transfer = new DataTransfer(); transfer.items.add(new File([source], name, { type: 'model/stl' }));
    document.querySelector('.viewport').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  }, { name: firstName, source: boxSTL(280, 160, 85.5) });
  await app.locator('.model-title').filter({ hasText: firstName.replace('.stl', '') }).waitFor({ timeout: 30000 });
  await app.locator('.save-status').filter({ hasText: /保存しました/ }).waitFor({ timeout: 30000 });
  const dimensions = await app.locator('.dimension-labels').textContent();
  assert.match(dimensions, /幅 280\.0 mm/);
  assert.match(dimensions, /奥行 160\.0 mm/);
  assert.match(dimensions, /高さ 85\.5 mm/);
  assert.equal(await app.locator('.model-card.selected .card-name').textContent(), firstName);
  const image = app.locator('.model-card.selected img');
  assert.equal(await image.evaluate((img) => img.decode().then(() => img.naturalWidth > 0, () => false)), true);
  assert.equal(await app.locator('.app-header .quest-button').count(), 0);
  const browserAction = app.getByRole('button', { name: 'ブラウザで表示', exact: true });
  const questAction = app.getByRole('button', { name: 'Questで開く', exact: true });
  assert.ok(await browserAction.isVisible());
  const browserBounds = await browserAction.boundingBox(), questBounds = await questAction.boundingBox();
  assert.ok(questBounds.x >= browserBounds.x + browserBounds.width, 'Quest action sits beside browser action');
  assert.notEqual(await questAction.evaluate(e => getComputedStyle(e).backgroundColor), await browserAction.evaluate(e => getComputedStyle(e).backgroundColor));
  const guide = app.locator('.quest-access-guide');
  assert.ok(await guide.isVisible());
  assert.match(await guide.textContent(), /Questのブラウザで/);
  assert.equal(await guide.locator('a').getAttribute('href'), 'https://stl-room-photors-projects.vercel.app/');
  assert.match(await guide.textContent(), /にアクセスしてください/);
  const guideBounds = await guide.boundingBox(), previewBounds = await app.locator('.canvas-host').boundingBox();
  assert.ok(guideBounds.y + guideBounds.height <= previewBounds.y, 'Quest URL guidance does not cover the model preview');
  messages.push('PASS: real upload, generated thumbnail, original CAD dimensions, active card');
  messages.push('PASS: paired browser/Quest actions, highlighted Quest button, public URL guidance');

  const canvas = app.locator('.canvas-host canvas');
  const snapshot = () => canvas.evaluate((element) => element.toDataURL());
  const bounds = await canvas.boundingBox();
  assert.ok(bounds);
  const beforeOrbit = await snapshot();
  await page.mouse.move(bounds.x + bounds.width * .5, bounds.y + bounds.height * .45);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * .65, bounds.y + bounds.height * .48, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(120);
  const afterOrbit = await snapshot();
  assert.notEqual(afterOrbit, beforeOrbit, 'drag should rotate the model');
  await page.waitForTimeout(300);
  assert.equal(await snapshot(), afterOrbit, 'rotation should pause after manual input');
  await page.waitForTimeout(3100);
  assert.notEqual(await snapshot(), afterOrbit, 'auto rotation should resume after three seconds');
  const beforeWheel = await snapshot();
  await page.mouse.wheel(0, -220);
  await page.waitForTimeout(150);
  assert.notEqual(await snapshot(), beforeWheel, 'wheel should zoom');
  const beforePan = await snapshot();
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(bounds.x + bounds.width * .55, bounds.y + bounds.height * .52, { steps: 8 });
  await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(100);
  assert.notEqual(await snapshot(), beforePan, 'right drag should pan');
  await app.locator('.fit-button').click();
  messages.push('PASS: orbit, pause/resume after three seconds, zoom, pan, fit');

  await input.setInputFiles(payload(secondName, 120, 80, 55));
  await app.locator('.model-title').filter({ hasText: secondName.replace('.stl', '') }).waitFor({ timeout: 30000 });
  await app.locator('.save-status').filter({ hasText: /保存しました/ }).waitFor({ timeout: 30000 });
  await app.locator('.model-card').filter({ hasText: firstName }).click();
  await app.locator('.model-title').filter({ hasText: firstName.replace('.stl', '') }).waitFor();
  assert.match(await app.locator('.dimension-labels').textContent(), /幅 280\.0 mm/);
  await app.locator('.quest-button').click();
  await app.locator('.share-dialog').waitFor({ state: 'visible' });
  const href = await app.locator('.web-launch').getAttribute('href');
  assert.ok(href.startsWith('https://www.oculus.com/open_url/?url='));
  assert.ok(new URL(href).searchParams.get('url').startsWith('https://'));
  assert.equal(await app.locator('.qr-code').evaluate((element) => element.width > 0 && !!element.getContext('2d').getImageData(20, 20, 1, 1)), true);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await app.locator('.copy-button').click();
  await app.locator('.copy-button').filter({ hasText: 'コピーしました' }).waitFor();
  assert.equal(await app.evaluate(() => navigator.clipboard.readText()), new URL(href).searchParams.get('url'));
  await app.locator('.close-dialog').click();
  messages.push('PASS: multiple persistent models, switching, encoded official Web Launch, rendered QR');

  const directory = join(workspaceRoot, 'artifacts');
  await mkdir(directory, { recursive: true });
  await app.locator('.stl-app').screenshot({ path: join(directory, 'desktop-final.png') });

  await input.setInputFiles({ name: 'broken.stl', mimeType: 'model/stl', buffer: Buffer.from('not a valid STL') });
  await app.locator('.toast.visible').filter({ hasText: /STLを読み込めません/ }).waitFor();
  assert.match(await app.locator('.model-title').textContent(), /精密ブラケット/);
  messages.push('PASS: corrupt file has Japanese feedback and preserves existing model');

  await page.reload();
  const reloadedApp = await findAppFrame(page);
  await reloadedApp.locator('.model-title').filter({ hasText: secondName.replace('.stl', '') }).waitFor({ timeout: 30000 });
  assert.equal(await reloadedApp.locator('.model-card').filter({ hasText: firstName }).count(), 1);
  assert.equal(await reloadedApp.locator('.model-card').filter({ hasText: secondName }).count(), 1);
  messages.push('PASS: reload restores shared server library and automatically shows newest model');

  const viewport = page.viewportSize();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  assert.equal(await reloadedApp.locator('.stl-app').evaluate((element) => element.scrollWidth <= element.clientWidth), true);
  await reloadedApp.locator('.stl-app').screenshot({ path: join(directory, 'mobile-final.png') });
  if (viewport) await page.setViewportSize(viewport);
  messages.push('PASS: mobile viewport has no horizontal overflow');
  return { passed: messages, screenshots: ['artifacts/desktop-final.png', 'artifacts/mobile-final.png'], modelsCreated: [firstName, secondName] };
}

async function findAppFrame(page) {
  for (let attempt = 0; attempt < 100; attempt++) {
    for (const candidate of page.frames()) if (await candidate.locator('.stl-app').count().catch(() => 0)) return candidate;
    await page.waitForTimeout(200);
  }
  throw new Error('Reloaded application frame was not found');
}

function boxSTL(width, depth, height) {
  const vertices = [[0,0,0],[width,0,0],[width,depth,0],[0,depth,0],[0,0,height],[width,0,height],[width,depth,height],[0,depth,height]];
  const triangles = [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]];
  return `solid box\n${triangles.map((triangle) => `facet normal 0 0 0\nouter loop\n${triangle.map((index) => `vertex ${vertices[index].join(' ')}`).join('\n')}\nendloop\nendfacet`).join('\n')}\nendsolid box`;
}
