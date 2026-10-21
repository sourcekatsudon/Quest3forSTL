export interface Dimensions { width: number; depth: number; height: number }
export interface STLData { positions: Float32Array; dimensions: Dimensions; triangles: number }
export const MAX_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_TRIANGLES = 1_000_000;

/** STL carries no units. Source X/Y/Z are interpreted as width/depth/height in mm. */
export function parseSTLData(buffer: ArrayBuffer): STLData {
  if (!buffer.byteLength) throw new Error('ファイルが空です。別のSTLファイルを選んでください。');
  if (buffer.byteLength > MAX_FILE_BYTES) throw new Error('50 MB以下のSTLファイルを選んでください。');
  const view = new DataView(buffer);
  const binaryCount = buffer.byteLength >= 84 ? view.getUint32(80, true) : 0;
  const binary = binaryCount > 0 && 84 + binaryCount * 50 <= buffer.byteLength;
  let positions: Float32Array;
  if (binary) {
    if (binaryCount > MAX_TRIANGLES) throw new Error('モデルが複雑すぎます。100万面以下に簡略化してください。');
    positions = new Float32Array(binaryCount * 9);
    for (let triangle = 0; triangle < binaryCount; triangle++) {
      const start = 84 + triangle * 50 + 12;
      for (let component = 0; component < 9; component++) positions[triangle * 9 + component] = view.getFloat32(start + component * 4, true);
    }
  } else {
    const source = new TextDecoder().decode(buffer);
    if (!/^\s*solid\b/i.test(source) || !/\bendsolid\b/i.test(source)) throw new Error('STLを読み込めませんでした。ファイルの形式を確認してください。');
    const number = '([+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][+-]?\\d+)?)';
    const vertex = new RegExp('\\bvertex\\s+' + number + '\\s+' + number + '\\s+' + number + '(?=\\s|$)', 'gi');
    const values: number[] = [];
    let match: RegExpExecArray | null;
    while ((match = vertex.exec(source))) {
      values.push(Number(match[1]), Number(match[2]), Number(match[3]));
      if (values.length > MAX_TRIANGLES * 9) throw new Error('モデルが複雑すぎます。100万面以下に簡略化してください。');
    }
    const facets = source.match(/\bfacet\s+normal\b/gi)?.length ?? 0;
    const ends = source.match(/\bendfacet\b/gi)?.length ?? 0;
    if (!values.length || values.length % 9 || facets * 9 !== values.length || facets !== ends) throw new Error('STLの三角形データが壊れています。');
    positions = new Float32Array(values);
  }
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < positions.length; index++) {
    const value = positions[index]!;
    if (!Number.isFinite(value) || Math.abs(value) > 1e9) throw new Error('モデルに無効な座標が含まれています。');
    const axis = index % 3;
    min[axis] = Math.min(min[axis]!, value);
    max[axis] = Math.max(max[axis]!, value);
  }
  const dimensions = { width: max[0]! - min[0]!, depth: max[1]! - min[1]!, height: max[2]! - min[2]! };
  if (Math.max(dimensions.width, dimensions.depth, dimensions.height) <= 0) throw new Error('大きさのないモデルは表示できません。');
  const center = min.map((value, axis) => (value + max[axis]!) / 2);
  for (let index = 0; index < positions.length; index += 3) {
    const x = (positions[index]! - center[0]!) * 0.001;
    const y = (positions[index + 1]! - center[1]!) * 0.001;
    const z = (positions[index + 2]! - center[2]!) * 0.001;
    positions[index] = x;
    positions[index + 1] = z;
    positions[index + 2] = -y;
  }
  return { positions, dimensions, triangles: positions.length / 9 };
}
