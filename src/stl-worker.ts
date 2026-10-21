import { parseSTLData } from './stl-parser';

self.onmessage = (event: MessageEvent<ArrayBuffer>) => {
  try {
    const parsed = parseSTLData(event.data);
    self.postMessage({ ok: true, ...parsed }, { transfer: [parsed.positions.buffer] });
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : 'STLを読み込めませんでした。' });
  }
};
