import { upload } from '@vercel/blob/client';
import type { LibraryResponse, ModelRecord } from '../shared/models';

export type { ModelRecord } from '../shared/models';
export class ModelLibrary extends EventTarget {
  models: ModelRecord[] = [];
  storage: 'local' | 'cloud' = 'local';
  private uploadBackend?: 'supabase';
  limits = { maxFileBytes: 50 * 1024 * 1024, maxModels: 50 };
  private refreshing: Promise<ModelRecord[]> | null = null;
  private removed = new Set<string>();
  // A successful binary transfer can be retried without uploading the same bytes again.
  private pendingUploads = new Map<string, { modelPathname: string; thumbnailPathname?: string; expires: number }>();

  refresh(): Promise<ModelRecord[]> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      const response = await fetch('/api/models', { cache: 'no-store', signal:AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error(await apiError(response,'ライブラリに接続できません。少し待ってお試しください。'));
      const result = await response.json() as LibraryResponse;
      this.models = result.models.filter(model => !this.removed.has(model.id));
      this.storage = result.storage;
      this.uploadBackend = result.uploadBackend;
      this.limits = result.limits;
      this.dispatchEvent(new Event('change'));
      return this.models;
    })().finally(() => { this.refreshing = null; });
    return this.refreshing;
  }

  async remove(id: string): Promise<void> {
    const response = await fetch(`/api/models?id=${encodeURIComponent(id)}`, { method: 'DELETE', signal: AbortSignal.timeout(45000) });
    if (!response.ok) throw new Error(await apiError(response, '削除できませんでした。接続を確認して再度お試しください。'));
    this.removed.add(id);
    this.models = this.models.filter(model => model.id !== id);
    this.dispatchEvent(new Event('change'));
  }

  async save(file: File, thumbnail?: Blob): Promise<ModelRecord> {
    if (file.size > this.limits.maxFileBytes) throw new Error(`${Math.round(this.limits.maxFileBytes / 1024 / 1024)} MB以下のSTL・STEPを選んでください。`);
    if (this.models.length >= this.limits.maxModels) throw new Error('保存できるモデル数の上限に達しました。');
    const supabase = this.storage === 'cloud' && this.uploadBackend === 'supabase';
    let retryKey: string | undefined;
    if (supabase) {
      const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
      retryKey = file.name + ':' + Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
      for (const [key, pending] of this.pendingUploads) if (pending.expires <= Date.now()) this.pendingUploads.delete(key);
    }
    const pending = retryKey ? this.pendingUploads.get(retryKey) : undefined;
    if (pending) return this.commitUpload(file.name, pending.modelPathname, pending.thumbnailPathname, retryKey);
    const id = crypto.randomUUID();
    const put = async (blob: Blob, kind: 'model' | 'thumbnail'): Promise<string> => {
      const extension = kind === 'model' ? file.name.split('.').at(-1)!.toLowerCase() : 'png';
      const contentType = kind === 'model' ? extension === 'stl' ? 'model/stl' : extension === 'glb' ? 'model/gltf-binary' : 'model/step' : 'image/png';
      if (this.storage === 'cloud' && this.uploadBackend === 'supabase') {
        const pathname = `uploads/${id}.${extension}`;
        const ticket = await fetch('/api/upload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pathname, size: blob.size }) });
        if (!ticket.ok) throw new Error(await apiError(ticket));
        const { url, pathname: reserved } = await ticket.json() as { url: string; pathname: string };
        if (reserved !== pathname || !url) throw new Error('保存先の発行に失敗しました。');
        const response = await fetch(url, { method: 'PUT', headers: { 'Content-Type': contentType, 'x-upsert': 'false', 'Cache-Control': 'max-age=3600' }, body: blob, credentials: 'omit' });
        if (!response.ok) throw new Error('Supabaseへのファイル送信に失敗しました。容量・通信状態を確認して再度お試しください。');
        return pathname;
      }
      if (this.storage === 'cloud') {
        const result = await upload(`uploads/${id}.${extension}`, blob, {
          access: 'private', handleUploadUrl: '/api/upload', contentType, multipart: kind === 'model',
        });
        return result.pathname;
      }
      const response = await fetch(`/api/local-upload?name=${encodeURIComponent(`${id}.${extension}`)}&kind=${kind}`, {
        method: 'POST', headers: { 'Content-Type': contentType }, body: blob,
      });
      if (!response.ok) throw new Error(await apiError(response));
      return ((await response.json()) as { pathname: string }).pathname;
    };
    const [modelPathname, thumbnailPathname] = this.uploadBackend === 'supabase'
      ? [await put(file, 'model'), thumbnail ? await put(thumbnail, 'thumbnail') : undefined]
      : await Promise.all([put(file, 'model'), thumbnail ? put(thumbnail, 'thumbnail') : undefined]);
    if (retryKey) {
      if (this.pendingUploads.size >= 16) this.pendingUploads.delete(this.pendingUploads.keys().next().value!);
      this.pendingUploads.set(retryKey, { modelPathname, thumbnailPathname, expires: Date.now() + 115 * 60 * 1000 });
    }
    return this.commitUpload(file.name, modelPathname, thumbnailPathname, retryKey);
  }

  private async commitUpload(name: string, modelPathname: string, thumbnailPathname?: string, retryKey?: string): Promise<ModelRecord> {
    let response: Response;
    try {
      response = await fetch('/api/models', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, modelPathname, thumbnailPathname }),
      });
    } catch (error) {
      if (retryKey) throw new Error('ファイル本体は送信済みですが、モデル登録の結果を確認できませんでした。同じファイルを再選択すると送信済みデータで再試行します。');
      throw error;
    }
    if (!response.ok) {
      if (retryKey && [404, 409, 410, 413, 422].includes(response.status)) this.pendingUploads.delete(retryKey);
      if (response.status === 504 || response.status === 524) {
        throw new Error(retryKey
          ? 'モデルの変換が制限時間を超えました。ファイル本体は保存済みです。同じファイルを再選択して変換を再試行するか、STEPを分割してください。'
          : 'モデルの変換が制限時間を超えました。STEPを分割して再試行してください。');
      }
      throw new Error(await apiError(response));
    }
    const { model } = await response.json() as { model: ModelRecord };
    if (retryKey) this.pendingUploads.delete(retryKey);
    this.models = [model, ...this.models.filter((item) => item.id !== model.id)];
    this.dispatchEvent(new Event('change'));
    return model;
  }
}

async function apiError(response: Response, fallback = '保存できませんでした。接続を確認してお試しください。'): Promise<string> {
  try {
    const result = await response.json() as { error?: string; message?: string };
    return result.message || result.error || fallback;
  } catch { return fallback; }
}
