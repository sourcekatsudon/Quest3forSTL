import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {glbJson} from './glb';
import { prepareModel, validateStep } from './prepare-model';
import type { ModelCommit, ModelRecord } from '../shared/models';
import { ApiError, idPattern, inspectStl, limits, MAX_THUMBNAIL_BYTES, validateName, validatePath, validatePng } from './validation';
import { modelFiles } from './model-files';

interface StoredModel extends ModelRecord { modelPathname: string; thumbnailPathname?: string; displayPathname?: string; assemblyPathname?: string }

/** Development persistence stays on the server filesystem, shared by every browser. */
export class LocalStore {
  private writes: Promise<unknown> = Promise.resolve();
  constructor(public directory = resolve(process.env.STL_LOCAL_DIR || '.stl-room-data')) {}

  async initialize() {
    await mkdir(join(this.directory, 'uploads'), { recursive: true });
    await mkdir(join(this.directory, 'models'), { recursive: true });
    await mkdir(join(this.directory, 'optimized'), { recursive: true });
    await mkdir(join(this.directory, 'assemblies'), { recursive: true });
  }

  async list(): Promise<ModelRecord[]> {
    await this.initialize();
    const names = (await readdir(join(this.directory, 'models'))).filter((n) => n.endsWith('.json'));
    const models = await Promise.all(names.map(async (n) => {
      try {
        const { modelPathname: _model, thumbnailPathname: _thumbnail, displayPathname: _display, assemblyPathname: _assembly, ...record } = JSON.parse(await readFile(join(this.directory, 'models', n), 'utf8')) as StoredModel;
        return record;
      } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
    }));
    return models.filter((model): model is ModelRecord => model !== null).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async upload(bytes: Uint8Array, kind: string, name: string): Promise<{ pathname: string }> {
    await this.initialize();
    if (kind === 'model') { validateName(name); /\.glb$/i.test(name) ? glbJson(bytes) : /\.(step|stp)$/i.test(name) ? validateStep(bytes) : inspectStl(bytes); }
    else if (kind === 'thumbnail') validatePng(bytes);
    else throw new ApiError(400, 'ファイルの種類が正しくありません。');
    if (kind === 'model' && (await this.list()).length >= limits.maxModels) throw new ApiError(409, 'モデルの保存上限に達しました。');
    const pathname = `uploads/${randomUUID()}.${kind === 'model' ? name.split('.').at(-1)!.toLowerCase() : 'png'}`;
    await writeFile(join(this.directory, pathname), bytes, { flag: 'wx' });
    return { pathname };
  }

  async commit(input: ModelCommit): Promise<ModelRecord> {
    // Serialize quota check + immutable record creation across local HTTP requests.
    const run = this.writes.then(async () => {
      const name = validateName(input.name);
      const pathname = validatePath(input.modelPathname, 'model');
      const thumbnailPathname = input.thumbnailPathname ? validatePath(input.thumbnailPathname, 'png') : undefined;
      if ((await this.list()).length >= limits.maxModels) throw new ApiError(409, 'モデルの保存上限に達しました。');
      const bytes = await this.readUpload(pathname, limits.maxFileBytes);
      if (thumbnailPathname) validatePng(await this.readUpload(thumbnailPathname, MAX_THUMBNAIL_BYTES));
      const id = randomUUID();
      const {source:{dimensions,triangles},optimized,assembly,format}=await prepareModel(bytes,name);
      const displayPathname = optimized.bytes !== bytes ? `optimized/${id}.stl` : undefined;
      if (displayPathname) await writeFile(join(this.directory, displayPathname), optimized.bytes, { flag: 'wx' });
      const assemblyPathname=assembly?`assemblies/${id}.json`:undefined;
      if(assemblyPathname)await writeFile(join(this.directory,assemblyPathname),JSON.stringify(assembly),{flag:'wx'});
      const record: ModelRecord = {
        id, name, createdAt: new Date().toISOString(), size: bytes.byteLength, dimensions, triangles,
        modelUrl: `/api/assets?id=${id}&kind=model&display=1`,
        originalModelUrl: `/api/assets?id=${id}&kind=original`, optimization: optimized.metadata,
        format, ...(assembly?{assemblyUrl:`/api/assets?id=${id}&kind=assembly`,partCount:assembly.parts.length}:{}),
        ...(thumbnailPathname ? { thumbnailUrl: `/api/assets?id=${id}&kind=thumbnail` } : {}),
      };
      const stored: StoredModel = { ...record, modelPathname: pathname, thumbnailPathname, displayPathname, assemblyPathname };
      const temporary = join(this.directory, 'models', `${id}.tmp`);
      await writeFile(temporary, JSON.stringify(stored), { flag: 'wx' });
      await rename(temporary, join(this.directory, 'models', `${id}.json`));
      return record;
    });
    this.writes = run.catch(() => undefined);
    return run;
  }

  async asset(id: string, kind: string): Promise<Uint8Array> {
    const record = JSON.parse(await readFile(join(this.directory, 'models', `${id}.json`), 'utf8')) as StoredModel;
    const pathname = kind === 'assembly' ? record.assemblyPathname : kind === 'thumbnail' ? record.thumbnailPathname : kind === 'original' ? record.modelPathname : record.displayPathname ?? record.modelPathname;
    if (!pathname) throw new ApiError(404, 'ファイルが見つかりません。');
    if (!/^(?:optimized\/[a-f0-9-]{36}\.stl|assemblies\/[a-f0-9-]{36}\.json)$/i.test(pathname)) validatePath(pathname, kind === 'thumbnail' ? 'png' : 'model');
    return this.readUpload(pathname, kind === 'thumbnail' ? MAX_THUMBNAIL_BYTES : limits.maxFileBytes);
  }

  async remove(id: string): Promise<void> {
    if (!idPattern.test(id)) throw new ApiError(400, 'モデルの指定が正しくありません。');
    const operation = this.writes.then(async () => {
      await this.initialize();
      const manifest = join(this.directory, 'models', `${id}.json`);
      let stored: StoredModel;
      try { stored = JSON.parse(await readFile(manifest, 'utf8')) as StoredModel; }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
      const retained = new Set<string>();
      for (const name of await readdir(join(this.directory, 'models'))) {
        if (!name.endsWith('.json') || name === `${id}.json`) continue;
        const other = JSON.parse(await readFile(join(this.directory, 'models', name), 'utf8')) as StoredModel;
        for (const path of modelFiles(other)) retained.add(path);
      }
      for (const path of modelFiles(stored)) if (!retained.has(path)) await rm(join(this.directory, path), { force: true });
      await rm(manifest, { force: true });
    });
    this.writes = operation.catch(() => undefined);
    return operation;
  }

  private async readUpload(pathname: string, maximum: number) {
    const bytes = await readFile(join(this.directory, pathname));
    if (bytes.length > maximum) throw new ApiError(413, 'ファイルが大きすぎます。');
    return bytes;
  }
}
