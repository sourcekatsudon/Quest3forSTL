export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function positiveLimit(value: string | undefined, fallback: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

export const limits = {
  maxFileBytes: positiveLimit(process.env.STL_MAX_FILE_BYTES, 50 * 1024 * 1024, 100 * 1024 * 1024),
  maxModels: positiveLimit(process.env.STL_MAX_MODELS, 100, 1000),
};
export const MAX_THUMBNAIL_BYTES = 512 * 1024;
export const MAX_TRIANGLES = 1_000_000;
export const uploadPattern = /^uploads\/([a-f0-9-]{36})\.(stl|step|stp|glb|png)$/i;
export const idPattern = /^[a-f0-9-]{36}$/i;

export function validatePath(path: unknown, extension: 'stl' | 'png' | 'model'): string {
  if (typeof path !== 'string' || !uploadPattern.test(path) || (extension === 'model' ? !/\.(stl|step|stp|glb)$/i.test(path) : !path.toLowerCase().endsWith(`.${extension}`))) {
    throw new ApiError(400, 'ファイルの保存先が正しくありません。');
  }
  return path;
}

export function validateName(value: unknown): string {
  if (typeof value !== 'string' || !/\.(stl|step|stp|glb)$/i.test(value) || value.length > 180 || /[\x00-\x1f\\/]/.test(value)) {
    throw new ApiError(400, 'STL・STEPファイル名を確認してください。');
  }
  return value;
}

/** Validate untrusted STL bytes independently of client supplied metadata. */
export function inspectStl(bytes: Uint8Array) {
  if (!bytes.byteLength || bytes.byteLength > limits.maxFileBytes) throw new ApiError(413, 'STLの容量上限を超えています。');
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const vertex = (x: number, y: number, z: number) => {
    for (const [axis, value] of [x, y, z].entries()) {
      if (!Number.isFinite(value) || Math.abs(value) > 1e9) throw new ApiError(422, 'STLに無効な座標があります。');
      min[axis] = Math.min(min[axis], value);
      max[axis] = Math.max(max[axis], value);
    }
  };
  let triangles = 0;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = bytes.byteLength >= 84 ? view.getUint32(80, true) : 0;
  if (count > 0 && 84 + count * 50 === bytes.byteLength) {
    if (count > MAX_TRIANGLES) throw new ApiError(413, '三角形が多すぎます。100万面以下に簡略化してください。');
    triangles = count;
    for (let offset = 84; offset < bytes.byteLength; offset += 50) {
      for (let v = offset + 12; v < offset + 48; v += 12) vertex(view.getFloat32(v, true), view.getFloat32(v + 4, true), view.getFloat32(v + 8, true));
    }
  } else {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (!/^\s*solid(?:\s|$)/i.test(text) || !/endsolid(?:\s|$)/i.test(text)) throw new ApiError(422, 'ASCIIまたはバイナリSTLを選択してください。');
    const number = '[+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][+-]?\\d+)?';
    const vector = `${number}\\s+${number}\\s+${number}`;
    const facet = new RegExp(`facet\\s+normal\\s+${vector}\\s+outer\\s+loop\\s+vertex\\s+(${vector})\\s+vertex\\s+(${vector})\\s+vertex\\s+(${vector})\\s+endloop\\s+endfacet`, 'gi');
    let match: RegExpExecArray | null;
    while ((match = facet.exec(text))) {
      if (++triangles > MAX_TRIANGLES) throw new ApiError(413, '三角形が多すぎます。100万面以下に簡略化してください。');
      for (let i = 1; i <= 3; i++) {
        const coords = match[i].trim().split(/\s+/).map(Number);
        vertex(coords[0], coords[1], coords[2]);
      }
    }
    const declared = text.match(/\bfacet\s+normal\b/gi)?.length ?? 0;
    if (!triangles || triangles !== declared || (text.match(/\bvertex\b/gi)?.length ?? 0) !== triangles * 3) {
      throw new ApiError(422, 'STLの三角形データが壊れています。');
    }
  }
  const dimensions = { width: max[0] - min[0], depth: max[1] - min[1], height: max[2] - min[2] };
  if (Math.max(...Object.values(dimensions)) <= 0) throw new ApiError(422, 'STLに表示できる形状がありません。');
  return { dimensions, triangles };
}

export function validatePng(bytes: Uint8Array) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.byteLength > MAX_THUMBNAIL_BYTES || bytes.byteLength < 24 || signature.some((b, i) => bytes[i] !== b)) {
    throw new ApiError(422, 'サムネイルを生成し直してください。');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(16) > 2048 || view.getUint32(20) > 2048) throw new ApiError(422, 'サムネイルの解像度が大きすぎます。');
}
