import { describe, expect, it } from 'vitest';
import { MAX_FILE_BYTES, MAX_TRIANGLES, parseSTLData } from '../src/stl-parser';

const ascii = (vertices: number[][]) => new TextEncoder().encode(`solid part\nfacet normal 0 0 1\nouter loop\n${vertices.map((vertex) => `vertex ${vertex.join(' ')}`).join('\n')}\nendloop\nendfacet\nendsolid part`).buffer;
function binary(vertices: number[][], header = 'binary STL'): ArrayBuffer {
  const buffer = new ArrayBuffer(134); const data = new DataView(buffer);
  new Uint8Array(buffer).set(new TextEncoder().encode(header)); data.setUint32(80, 1, true);
  vertices.flat().forEach((number, index) => data.setFloat32(96 + index * 4, number, true));
  return buffer;
}

describe('shared STL loader', () => {
  it('preserves original CAD dimensions while centering and converting mm to metres, Z-up to Y-up', () => {
    const result = parseSTLData(ascii([[10, 20, 30], [290, 20, 30], [10, 180, 115.5]]));
    expect(result.dimensions).toEqual({ width: 280, depth: 160, height: 85.5 });
    expect(result.triangles).toBe(1);
    expect(result.positions[0]).toBeCloseTo(-.14);
    expect(result.positions[1]).toBeCloseTo(-.04275);
    expect(result.positions[2]).toBeCloseTo(.08);
    expect(result.positions[7]).toBeCloseTo(.04275);
    expect(result.positions[8]).toBeCloseTo(-.08);
  });
  it('loads binary files even when their header starts with solid', () => {
    const result = parseSTLData(binary([[0, 0, 0], [100, 0, 0], [0, 25, 50]], 'solid this is actually binary'));
    expect(result.dimensions).toEqual({ width: 100, depth: 25, height: 50 });
    expect(result.triangles).toBe(1);
  });
  it('supports scientific notation and CRLF in ASCII', () => {
    const source = 'solid p\r\nfacet normal 0 0 1\r\nouter loop\r\nvertex -1e2 .5 +2E1\r\nvertex 1e2 .5 20\r\nvertex 0 50.5 30\r\nendloop\r\nendfacet\r\nendsolid p';
    expect(parseSTLData(new TextEncoder().encode(source).buffer).dimensions).toEqual({ width: 200, depth: 50, height: 10 });
  });
  it('rejects empty, unrelated, truncated, non-finite, and degenerate input', () => {
    expect(() => parseSTLData(new ArrayBuffer(0))).toThrow();
    expect(() => parseSTLData(new TextEncoder().encode('<html>not STL</html>').buffer)).toThrow();
    expect(() => parseSTLData(binary([[0, 0, 0], [10, 0, 0], [0, 20, 0]]).slice(0, 129))).toThrow();
    expect(() => parseSTLData(binary([[0, 0, 0], [NaN, 0, 0], [0, 20, 0]]))).toThrow();
    expect(() => parseSTLData(ascii([[1, 1, 1], [1, 1, 1], [1, 1, 1]]))).toThrow();
    expect(() => parseSTLData(ascii([[0, 0, 0], [10, 0, 0]]))).toThrow();
  });
  it('rejects a file above the memory and abuse limit', () => {
    expect(() => parseSTLData(new ArrayBuffer(MAX_FILE_BYTES + 1))).toThrow('50 MB');
  });
  it('exposes a bounded render budget', () => { expect(MAX_TRIANGLES).toBe(1_000_000); });
});
