export interface ModelRecord {
  id: string;
  name: string;
  createdAt: string;
  size: number;
  /** Original CAD axes: X = width, Y = depth, Z = height, in millimetres. */
  dimensions: { width: number; depth: number; height: number };
  triangles: number;
  modelUrl: string;
  thumbnailUrl?: string;
  /** Original upload remains available; modelUrl may serve a lighter display copy. */
  originalModelUrl?: string;
  format?: 'stl' | 'step' | 'glb';
  assemblyUrl?: string;
  partCount?: number;
  optimization?: {
    version: 1;
    triangles: number;
    size: number;
    targetTriangles: number;
    estimatedErrorMm: number;
    errorLimitMm: number;
    status: 'simplified' | 'unchanged' | 'quality-limited' | 'failed';
  };
}

/** Ranges in the display STL, in triangles; all parts share assembly coordinates in mm. */
export interface AssemblyPart { name: string; path: string[]; start: number; count: number }
export interface AssemblyData { version: 1; parts: AssemblyPart[] }

export interface LibraryResponse {
  models: ModelRecord[];
  storage: 'local' | 'cloud';
  limits: { maxFileBytes: number; maxModels: number };
}

export interface ModelCommit {
  name: string;
  modelPathname: string;
  thumbnailPathname?: string;
}
