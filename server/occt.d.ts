declare module 'occt-import-js' {
  interface Node { name: string; meshes: number[]; children: Node[] }
  interface Mesh { name: string; attributes: { position: { array: number[] } }; index: { array: number[] } }
  interface Result { success: boolean; root: Node; meshes: Mesh[] }
  export default function initialize(options?: {wasmBinary?: Uint8Array; print?: (line:string)=>void; printErr?: (line:string)=>void}): Promise<{ReadStepFile(bytes: Uint8Array, options: Record<string,unknown>): Result}>;
}
