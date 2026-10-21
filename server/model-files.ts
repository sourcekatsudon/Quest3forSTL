import { ApiError, idPattern, validatePath } from './validation.js';

interface ModelFiles { id: string; modelPathname: string; thumbnailPathname?: string; displayPathname?: string; assemblyPathname?: string }
/** Resolve only app-owned paths; never accept deletion paths from the request. */
export function modelFiles(record: ModelFiles): string[] {
 if (!idPattern.test(record.id)) throw new ApiError(400, 'モデルの指定が正しくありません。');
 const files = [validatePath(record.modelPathname, 'model')];
 if (record.thumbnailPathname) files.push(validatePath(record.thumbnailPathname, 'png'));
 for (const [path, expected] of [[record.displayPathname, `optimized/${record.id}.stl`], [record.assemblyPathname, `assemblies/${record.id}.json`]]) {
  if (!path) continue;
  if (path !== expected) throw new ApiError(400, 'モデルの保存先が正しくありません。');
  files.push(path);
 }
 return [...new Set(files)];
}
