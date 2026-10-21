import {
  AmbientLight, Box3, BufferGeometry, CanvasTexture, CircleGeometry, Color,
  DirectionalLight, Float32BufferAttribute, Group, HemisphereLight, LineBasicMaterial,
  LineSegments, Mesh, MeshBasicMaterial, MeshStandardMaterial, PerspectiveCamera,
  Scene, SRGBColorSpace, Vector3, WebGLRenderer, ACESFilmicToneMapping,
} from '@iwsdk/core';
import QRCode from 'qrcode';
import { ModelLibrary, type ModelRecord } from './library';
import { loadSTL, loadGLB, cloneModelScene, disposeParsed, disposeModelScene, type ParsedModel } from './model';
import { ModelPlayback } from './playback';
import { PhotoGallery } from './photos';
import './styles.css';
import type { AssemblyData } from '../shared/models';
import { createAssembly, applyExplosion, assemblyRadius, type ExplodedPart } from './assembly';

const cubeIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3"><path d="m12 2 9 5v10l-9 5-9-5V7zM3 7l9 5 9-5M12 12v10M7.5 4.5l9 5"/></svg>`;
const plusIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 5v14M5 12h14"/></svg>`;
const headsetIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 8c1-2 15-2 16 0l1 8c0 3-5 3-7 0h-4c-2 3-7 3-7 0zM7 11h2m6 0h2"/></svg>`;
const arrowIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M5 12h14m-6-6 6 6-6 6"/></svg>`;
const formatSize = (size: number) => size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024))} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

export class DesktopApp {
  readonly library = new ModelLibrary();
  onXRRequest?: () => void;
  onModelSelected?: (record: ModelRecord, parsed: ParsedModel) => void;
  onLibraryChanged?: (models: ModelRecord[]) => void;
  private gallery: PhotoGallery;
  private host: HTMLElement;
  private viewport: HTMLElement;
  private canvasHost: HTMLElement;
  private list: HTMLElement;
  private fileInput: HTMLInputElement;
  private status: HTMLElement;
  private toast: HTMLElement;
  private dialog: HTMLDialogElement;
  private renderer: WebGLRenderer | null = null;
  private scene = new Scene();
  private camera = new PerspectiveCamera(36, 1, 0.0001, 10000);
  private group = new Group();
  private model: Mesh | Group | null = null;
  private playback: ModelPlayback | null = null;
  private assemblyParts: ExplodedPart[] = [];
  private explosion = 0;
  private lines: LineSegments | null = null;
  private shadow: Mesh | null = null;
  private material = new MeshStandardMaterial({ color: 0xb8bfc1, metalness: 0.08, roughness: 0.47 });
  private active: ModelRecord | null = null;
  private parsed: ParsedModel | null = null;
  private cache = new Map<string, ParsedModel>();
  private pending: ModelRecord[] = [];
  private temp = new Vector3();
  private dimensionPoints: Vector3[] = [];
  private labels: HTMLElement[] = [];
  private target = new Vector3();
  private radius = 1;
  private initialRadius = 1;
  private theta = Math.PI / 4;
  private phi = 1.15;
  private lastInput = 0;
  private pointer = { id: -1, x: 0, y: 0, button: 0 };
  private pointers = new Map<number, { x: number; y: number }>();
  private pinchDistance = 0;
  private previousTime = 0;
  private requestId = 0;
  private selectionVersion = 0;
  private dragDepth = 0;
  private toastTimer = 0;
  private pollTimer = 0;
  private resizeObserver: ResizeObserver;
  private immersive = false;
  private xrAvailable = false;
  private uploading = 0;
  private connected = false;
  private disposed = false;

  constructor(root: HTMLElement) {
    this.host = document.createElement('div');
    this.host.className = 'stl-app';
    this.host.innerHTML = `
      <header class="app-header"><a class="brand" href="./" aria-label="Quest3でSTLファイルを立体で見るアプリ ホーム"><span class="brand-mark">${cubeIcon}</span><span>Quest3でSTLファイルを立体で見るアプリ</span></a><div class="header-tools"><span class="header-tagline">3Dモデルを、目の前に。</span><button class="photos-button" type="button">写真</button></div></header>
      <main class="workspace"><section class="viewport" aria-label="3Dモデルのプレビュー"><div class="viewport-eyebrow"><span class="live-dot"></span> YOUR OBJECT, IN PERSPECTIVE</div><div class="canvas-host"></div><div class="empty-state"><div class="empty-symbol">${cubeIcon}<span class="symbol-orbit"></span></div><p class="empty-kicker">アイデアに、かたちを。</p><h1>STL・STEP・GLBファイルを<br class="mobile-break">ここに置いてください</h1><p class="empty-description">あなたのモデルを、美しく。実寸で。目の前に。</p><button class="choose-button" type="button">${plusIcon}<span>またはファイルを選ぶ</span></button><span class="file-note">.stl / .step / .stp / .glb · 最大50 MB · 寸法はmm表示</span></div><div class="dimension-labels" aria-hidden="true"><span></span><span></span><span></span></div><div class="model-caption" hidden><div><span class="model-caption-label">現在のモデル</span><h1 class="model-title"></h1></div><div class="caption-tools"><button class="explode-button" type="button" aria-expanded="false" aria-controls="explode-controls" disabled title="部品構成のあるSTEPで利用できます">爆発図</button><button class="fit-button" type="button" title="表示を元に戻す" aria-label="表示を元に戻す"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M8 8h8v8H8z"/></svg></button></div></div><div id="explode-controls" class="explode-controls" hidden><div class="explode-heading"><label for="explode-range">部品の分離量</label><span class="part-count"></span><output for="explode-range">0%</output></div><input id="explode-range" class="explode-range" type="range" min="0" max="100" step="1" value="0" aria-label="部品の分離量"><p>0%で元の組立位置に戻ります</p></div><div class="viewer-footer"><span class="viewer-mode"><span class="live-dot"></span><span class="mode-text">STL VIEWER</span></span><span class="mouse-hints" hidden>ドラッグで回転<span>·</span>スクロールで拡大<span>·</span>右ドラッグで移動</span><span class="unit-note">1 unit = 1 mm</span></div><div class="quest-access-guide" hidden><p>Questのブラウザで</p><a href="https://stl-room-photors-projects.vercel.app/" target="_blank" rel="noopener">https://stl-room-photors-projects.vercel.app/</a><p>にアクセスしてください</p></div><div class="viewer-actions"><button class="xr-entry browser-view-button" type="button"><span>ブラウザで表示</span></button><button class="quest-button quest-primary" type="button">${headsetIcon}<span>Questで開く</span>${arrowIcon}</button></div><div class="drop-overlay"><div>${plusIcon}<strong>ここにドロップ</strong><span>モデルの新しい居場所へ。</span></div></div></section>
      <aside class="library-panel" aria-label="モデルライブラリ"><div class="library-heading"><div><span class="section-kicker">YOUR COLLECTION</span><h2>ライブラリ <span class="model-count">00</span></h2></div><button class="add-button" type="button" aria-label="STL・STEP・GLBファイルを追加">${plusIcon}</button></div><div class="storage-line"><span class="storage-dot"></span><span class="storage-text">ライブラリに接続中</span></div><div class="model-list"></div><div class="library-bottom"><span class="save-status" role="status" aria-live="polite">モデルを置くだけで、自動保存。</span><p>ひとつのライブラリ。<br>PCから、あなたの空間へ。</p><span class="library-bottom-mark">Quest3でSTLファイルを立体で見るアプリ <span>↗</span></span></div></aside></main>
      <input class="file-input" type="file" accept=".stl,.step,.stp,.glb" multiple hidden><div class="toast" role="status" aria-live="polite"></div>
      <dialog class="share-dialog"><button class="close-dialog" type="button" aria-label="閉じる">×</button><div class="dialog-icon">${headsetIcon}</div><span class="section-kicker">FROM SCREEN TO SPACE</span><h2>あなたのモデルを、空間へ。</h2><p>Questブラウザで同じライブラリを開いて、<br>目の前に実寸のモデルを。</p><a class="web-launch" target="_blank" rel="noopener">Questに送る ${arrowIcon}</a><div class="share-divider"><span>または同じURLで開く</span></div><div class="qr-row"><canvas class="qr-code" width="128" height="128" aria-label="このサイトのURLのQRコード"></canvas><div><p class="share-url"></p><button class="copy-button" type="button">URLをコピー <span>↗</span></button><small>スマートフォンなどで読み取れます</small></div></div><p class="share-note">Quest上では「ブラウザで表示」を押してください。</p></dialog>`;
    root.append(this.host);
    this.gallery = new PhotoGallery(this.host);
    this.host.querySelector('.photos-button')!.addEventListener('click', () => this.gallery.open());
    this.viewport = this.host.querySelector('.viewport')!;
    this.canvasHost = this.host.querySelector('.canvas-host')!;
    this.list = this.host.querySelector('.model-list')!;
    this.fileInput = this.host.querySelector('.file-input')!;
    this.status = this.host.querySelector('.save-status')!;
    this.toast = this.host.querySelector('.toast')!;
    this.dialog = this.host.querySelector('.share-dialog')!;
    this.labels = Array.from(this.host.querySelectorAll('.dimension-labels span'));
    this.host.querySelectorAll('.choose-button,.add-button').forEach((button) => button.addEventListener('click', () => this.fileInput.click()));
    this.fileInput.addEventListener('change', () => { const files = Array.from(this.fileInput.files ?? []); this.fileInput.value = ''; void this.openFiles(files); });
    this.host.querySelector('.quest-button')!.addEventListener('click', () => this.openShare());
    this.host.querySelector('.xr-entry')!.addEventListener('click', () => {
      if (this.xrAvailable) this.onXRRequest?.();
      else { this.fitCamera(); this.renderer?.domElement.focus(); }
    });
    this.host.querySelector('.fit-button')!.addEventListener('click', () => this.fitCamera());
    this.host.querySelector('.explode-button')!.addEventListener('click', () => {
      const panel=this.host.querySelector('.explode-controls') as HTMLElement;
      const open=panel.hidden;panel.hidden=!open;
      this.host.classList.toggle('explosion-open',open);
      this.host.querySelector('.explode-button')!.setAttribute('aria-expanded',String(open));
      if(!open)this.setExplosion(0);
      this.resize();this.fitCamera();
    });
    this.host.querySelector('.explode-range')!.addEventListener('input',event=>this.setExplosion(Number((event.target as HTMLInputElement).value)/100));
    this.host.querySelector('.close-dialog')!.addEventListener('click', () => this.dialog.close());
    this.dialog.addEventListener('click', (event) => { if (event.target === this.dialog) this.dialog.close(); });
    this.host.querySelector('.copy-button')!.addEventListener('click', () => void this.copyURL());
    this.host.addEventListener('dragenter', (event) => { event.preventDefault(); if (event.dataTransfer?.types.includes('Files')) { this.dragDepth++; this.viewport.classList.add('drag-over'); } });
    this.host.addEventListener('dragover', (event) => { event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'; });
    this.host.addEventListener('dragleave', (event) => { event.preventDefault(); if (--this.dragDepth <= 0) { this.dragDepth = 0; this.viewport.classList.remove('drag-over'); } });
    this.host.addEventListener('drop', (event) => { event.preventDefault(); this.dragDepth = 0; this.viewport.classList.remove('drag-over'); void this.openFiles(Array.from(event.dataTransfer?.files ?? [])); });
    this.library.addEventListener('change', () => { this.connected = true; this.renderLibrary(); this.onLibraryChanged?.(this.library.models); });
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.viewport);
    this.resizeObserver.observe(this.canvasHost);
    this.initRenderer();
    this.renderLibrary();
    void this.refresh().catch(() => { this.setStorageOffline(); });
    this.pollTimer = window.setInterval(() => { if (!document.hidden && !this.uploading) void this.refresh().catch(() => this.setStorageOffline()); }, 12_000);
  }

  get current(): { record: ModelRecord; parsed: ParsedModel } | null { return this.active && this.parsed ? { record: this.active, parsed: this.parsed } : null; }

  async refresh(): Promise<void> {
    const wasEmpty = !this.active;
    const previous = this.library.models[0]?.id;
    await this.library.refresh();
    if ((wasEmpty || (this.immersive && previous !== this.library.models[0]?.id)) && this.library.models[0]) await this.show(this.library.models[0]);
  }

  setXRAvailable(available: boolean): void { this.xrAvailable = available; this.host.classList.toggle('xr-available', available); }
  setImmersive(active: boolean): void { this.immersive = active; this.host.classList.toggle('immersive', active); }
  notify(message: string): void { this.toast.textContent = message; this.toast.classList.add('visible'); clearTimeout(this.toastTimer); this.toastTimer = window.setTimeout(() => this.toast.classList.remove('visible'), 5000); }

  async show(record: ModelRecord): Promise<void> {
    const version = ++this.selectionVersion;
    try {
      let parsed = this.cache.get(record.id);
      if (!parsed) {
        this.status.textContent = 'モデルを読み込み中…';
        const response = await fetch(record.modelUrl);
        if (!response.ok) throw new Error('モデルを読み込めませんでした。接続を確認してください。');
        parsed = await (record.format==='glb'?loadGLB:loadSTL)(await response.arrayBuffer());
        parsed.dimensions = record.dimensions;
        if(record.assemblyUrl){
          const assemblyResponse=await fetch(record.assemblyUrl);
          if(!assemblyResponse.ok){disposeParsed(parsed);throw new Error('部品構成を読み込めませんでした。再度選択してください。');}
          const assembly=await assemblyResponse.json() as AssemblyData;
          let end=0;
          if(assembly.version!==1||!Array.isArray(assembly.parts)||!assembly.parts.length||assembly.parts.length>1000)throw new Error('部品構成が壊れています。');
          for(const part of assembly.parts){
            if(!Number.isSafeInteger(part.start)||!Number.isSafeInteger(part.count)||part.start!==end||part.count<=0)throw new Error('部品の範囲が壊れています。');
            end+=part.count;
          }
          if(end!==parsed.triangles)throw new Error('部品構成と表示モデルが一致しません。');
          parsed.parts=assembly.parts;
        }
        if (this.disposed) { disposeParsed(parsed); return; }
        this.cache.set(record.id, parsed);
      }
      if (version !== this.selectionVersion) return;
      this.display(record, parsed);
      this.status.textContent = this.uploading ? '保存中… プレビューは操作できます' : record.id.startsWith('pending-') ? '未保存 · モデルはプレビューのみ' : 'すべてのモデルを保存済み';
    } catch (error) { if (version === this.selectionVersion) this.notify(error instanceof Error ? error.message : 'モデルを読み込めませんでした。'); }
  }

  private initRenderer(): void {
    try {
      this.renderer = new WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      this.renderer.outputColorSpace = SRGBColorSpace;
      this.renderer.toneMapping = ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.3;
      this.renderer.domElement.setAttribute('aria-label', 'STLモデル。ドラッグで回転、スクロールで拡大、右ドラッグで移動');
      this.renderer.domElement.tabIndex = 0;
      this.canvasHost.append(this.renderer.domElement);
      this.scene.add(new HemisphereLight(0xffffff, 0x868f96, 3.1), new AmbientLight(0xffffff, 0.25));
      const key = new DirectionalLight(0xffffff, 3.4); key.position.set(4, 7, 5);
      const rim = new DirectionalLight(0xdceef4, 2.2); rim.position.set(-4, 2, -3);
      this.scene.add(key, rim, this.group);
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
      const context = canvas.getContext('2d')!;
      const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64); gradient.addColorStop(0, 'rgba(46,57,62,.2)'); gradient.addColorStop(.45, 'rgba(46,57,62,.1)'); gradient.addColorStop(1, 'rgba(46,57,62,0)'); context.fillStyle = gradient; context.fillRect(0, 0, 128, 128);
      const texture = new CanvasTexture(canvas);
      this.shadow = new Mesh(new CircleGeometry(1, 64), new MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }));
      this.shadow.rotation.x = -Math.PI / 2; this.shadow.visible = false; this.scene.add(this.shadow);
      this.bindPointer(this.renderer.domElement);
      this.resize(); this.frame(0);
    } catch { this.notify('3D表示を開始できませんでした。WebGL対応のブラウザで開いてください。'); }
  }

  private bindPointer(canvas: HTMLCanvasElement): void {
    canvas.addEventListener('contextmenu', (event) => event.preventDefault());
    canvas.addEventListener('pointerdown', (event) => {
      canvas.setPointerCapture(event.pointerId); this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY }); this.lastInput = performance.now();
      this.pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, button: event.button };
      if (this.pointers.size === 2) this.pinchDistance = this.pointerDistance();
      canvas.classList.add('is-dragging');
    });
    canvas.addEventListener('pointermove', (event) => {
      if (!this.pointers.has(event.pointerId)) return;
      this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      this.lastInput = performance.now();
      if (this.pointers.size === 2) {
        const distance = this.pointerDistance();
        if (distance > 0 && this.pinchDistance > 0) this.radius = Math.max(this.initialRadius * .08, Math.min(this.initialRadius * 10, this.radius * this.pinchDistance / distance));
        this.pinchDistance = distance;
      } else {
        const dx = event.clientX - this.pointer.x, dy = event.clientY - this.pointer.y;
        if (this.pointer.button === 2 || event.shiftKey) {
          const speed = this.radius * .0015;
          this.target.x -= Math.cos(this.theta) * dx * speed; this.target.z += Math.sin(this.theta) * dx * speed; this.target.y += dy * speed;
        } else { this.theta -= dx * .006; this.phi = Math.max(.12, Math.min(Math.PI - .12, this.phi - dy * .006)); }
      }
      this.pointer.x = event.clientX; this.pointer.y = event.clientY;
    });
    const release = (event: PointerEvent) => { this.pointers.delete(event.pointerId); this.lastInput = performance.now(); canvas.classList.remove('is-dragging'); const remaining = this.pointers.entries().next().value as [number, { x: number; y: number }] | undefined; if (remaining) this.pointer = { id: remaining[0], ...remaining[1], button: 0 }; };
    canvas.addEventListener('pointerup', release); canvas.addEventListener('pointercancel', release);
    canvas.addEventListener('wheel', (event) => { event.preventDefault(); this.radius = Math.max(this.initialRadius * .08, Math.min(this.initialRadius * 10, this.radius * Math.exp(event.deltaY * .001))); this.lastInput = performance.now(); }, { passive: false });
    canvas.addEventListener('keydown', (event) => {
      if (!this.model) return;
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', 'Home'].includes(event.key)) event.preventDefault();
      if (event.key === 'ArrowLeft') this.theta -= .12;
      if (event.key === 'ArrowRight') this.theta += .12;
      if (event.key === 'ArrowUp') this.phi = Math.max(.12, this.phi - .1);
      if (event.key === 'ArrowDown') this.phi = Math.min(Math.PI - .12, this.phi + .1);
      if (event.key === '+' || event.key === '=') this.radius = Math.max(this.initialRadius * .08, this.radius * .9);
      if (event.key === '-') this.radius = Math.min(this.initialRadius * 10, this.radius * 1.1);
      if (event.key === 'Home') this.fitCamera();
      this.lastInput = performance.now();
    });
  }

  private pointerDistance(): number { const points = Array.from(this.pointers.values()); return Math.hypot(points[0]!.x - points[1]!.x, points[0]!.y - points[1]!.y); }

  private display(record: ModelRecord, parsed: ParsedModel): void {
    this.active = record;
    const previousParsed=this.parsed;this.parsed = parsed;
    this.playback?.dispose();this.playback=null;
    if (this.model) {this.group.remove(this.model);if(previousParsed?.scene)disposeModelScene(this.model);}
    for(const part of this.assemblyParts)part.mesh.geometry.dispose();
    this.assemblyParts=[];this.explosion=0;
    if(parsed.parts && parsed.parts.length>1){
      const assembly=createAssembly(parsed,this.material);this.model=assembly.group;this.assemblyParts=assembly.parts;
    }else this.model = parsed.scene ? cloneModelScene(parsed.scene) : new Mesh(parsed.geometry, this.material);
    this.model.name = 'DesktopModel'; this.group.add(this.model);
    if(parsed.animations?.length)this.playback=new ModelPlayback(this.model);
    const explodeButton=this.host.querySelector('.explode-button') as HTMLButtonElement;
    explodeButton.disabled=this.assemblyParts.length<2;
    explodeButton.title=explodeButton.disabled?'部品構成のあるSTEPで利用できます':'部品を離して表示する';
    explodeButton.setAttribute('aria-expanded','false');
    (this.host.querySelector('.explode-controls') as HTMLElement).hidden=true;
    this.host.classList.remove('explosion-open');
    (this.host.querySelector('.explode-range') as HTMLInputElement).value='0';
    this.host.querySelector('.explode-controls output')!.textContent='0%';
    this.host.querySelector('.part-count')!.textContent=`${this.assemblyParts.length} 部品`;
    this.group.rotation.set(0, 0, 0);
    this.buildDimensions(parsed);
    this.host.querySelector('.dimension-labels')!.classList.remove('is-exploded');
    this.host.classList.add('has-model');
    (this.host.querySelector('.quest-access-guide') as HTMLElement).hidden = false;
    this.resize(); this.fitCamera();
    (this.host.querySelector('.model-caption') as HTMLElement).hidden = false;
    (this.host.querySelector('.mouse-hints') as HTMLElement).hidden = false;
    this.host.querySelector('.model-title')!.textContent = record.name.replace(/\.(stl|step|stp|glb)$/i, '');
    this.host.querySelector('.mode-text')!.textContent = `${parsed.triangles.toLocaleString('ja-JP')} 三角形 · ${formatSize(record.size)}`;
    this.canvasHost.classList.remove('model-enter'); void this.canvasHost.offsetWidth; this.canvasHost.classList.add('model-enter');
    this.renderLibrary(); this.onModelSelected?.(record, parsed); this.trimCache();
  }

  private setExplosion(value:number):void {
    this.explosion=Math.max(0,Math.min(1,value));applyExplosion(this.assemblyParts,this.explosion);
    (this.host.querySelector('.explode-range') as HTMLInputElement).value=String(Math.round(this.explosion*100));
    this.host.querySelector('.explode-controls output')!.textContent=`${Math.round(this.explosion*100)}%`;
    if(this.lines)this.lines.visible=this.explosion===0;
    this.host.querySelector('.dimension-labels')!.classList.toggle('is-exploded',this.explosion>0);
    if(this.shadow)this.shadow.visible=this.explosion===0;
    const theta=this.theta,phi=this.phi;this.fitCamera();this.theta=theta;this.phi=phi;
  }

  private fitCamera(): void {
    if (!this.parsed) return;
    const radius = this.explosion>0 && this.model instanceof Group ? assemblyRadius(this.model) : this.parsed.geometry.boundingSphere?.radius ?? .1;
    const aspect = this.camera.aspect;
    const halfFov = Math.atan(Math.tan(this.camera.fov * Math.PI / 360) * Math.min(aspect, 1));
    this.initialRadius = this.radius = radius / Math.sin(halfFov) * 1.34;
    this.camera.near = Math.max(radius / 1000, .000001); this.camera.far = Math.max(radius * 100, 100); this.camera.updateProjectionMatrix();
    this.theta = Math.PI / 4; this.phi = 1.12; this.target.set(0, 0, 0); this.lastInput = performance.now();
  }

  private buildDimensions(parsed: ParsedModel): void {
    if (this.lines) { this.group.remove(this.lines); this.lines.geometry.dispose(); (this.lines.material as LineBasicMaterial).dispose(); }
    const { width, height, depth } = parsed.dimensions;
    const x = width * .0005, y = height * .0005, z = depth * .0005;
    const gap = Math.max(x, y, z) * .24;
    const tick = gap * .18;
    const segments: number[] = [];
    const line = (a: number[], b: number[]) => segments.push(...a, ...b);
    line([-x, -y - gap, z + gap], [x, -y - gap, z + gap]);
    for (const edge of [-x, x]) line([edge, -y - gap - tick, z + gap], [edge, -y + tick, z + gap]);
    line([-x - gap, -y - gap, -z], [-x - gap, -y - gap, z]);
    for (const edge of [-z, z]) line([-x - gap - tick, -y - gap, edge], [-x + tick, -y - gap, edge]);
    line([x + gap, -y, -z - gap], [x + gap, y, -z - gap]);
    for (const edge of [-y, y]) line([x - tick, edge, -z - gap], [x + gap + tick, edge, -z - gap]);
    const geometry = new BufferGeometry(); geometry.setAttribute('position', new Float32BufferAttribute(segments, 3));
    this.lines = new LineSegments(geometry, new LineBasicMaterial({ color: 0x879c9f, transparent: true, opacity: .48, depthTest: false }));
    this.lines.renderOrder = 2; this.group.add(this.lines);
    this.dimensionPoints = [new Vector3(0, -y - gap * 1.52, z + gap), new Vector3(-x - gap * 1.9, -y - gap, 0), new Vector3(x + gap * 1.8, 0, -z - gap)];
    [width, depth, height].forEach((value, index) => { this.labels[index]!.textContent = `${['幅', '奥行', '高さ'][index]} ${value.toLocaleString('ja-JP', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} mm`; });
    if (this.shadow) { this.shadow.visible = true; this.shadow.position.y = -y - gap * .28; this.shadow.scale.set(Math.max(x, z) * 2.4, Math.max(x, z) * 2.4, 1); }
  }

  private frame = (time: number): void => {
    if (this.disposed) return;
    const delta = Math.min((time - this.previousTime) / 1000, .05); this.previousTime = time;
    if (this.renderer && !this.immersive && !document.hidden) {
      this.playback?.update(delta);
      if (this.model && !this.pointers.size && time - this.lastInput > 3000 && !reducedMotion) this.group.rotation.y += delta * .12;
      this.camera.position.set(this.target.x + this.radius * Math.sin(this.phi) * Math.sin(this.theta), this.target.y + this.radius * Math.cos(this.phi), this.target.z + this.radius * Math.sin(this.phi) * Math.cos(this.theta));
      this.camera.lookAt(this.target);
      this.renderer.render(this.scene, this.camera);
      if (this.model) for (let index = 0; index < this.dimensionPoints.length; index++) {
        this.temp.copy(this.dimensionPoints[index]!); this.group.localToWorld(this.temp); this.temp.project(this.camera);
        const label = this.labels[index]!; label.style.transform = `translate(${this.canvasHost.offsetLeft + (this.temp.x * .5 + .5) * this.canvasHost.clientWidth}px,${this.canvasHost.offsetTop + (-this.temp.y * .5 + .5) * this.canvasHost.clientHeight}px) translate(-50%,-50%)`;
        label.style.visibility = this.temp.z > 1 || this.temp.z < -1 ? 'hidden' : 'visible';
      }
    }
    this.requestId = requestAnimationFrame(this.frame);
  };

  private resize(): void {
    const width = this.canvasHost.clientWidth, height = this.canvasHost.clientHeight;
    if (!width || !height) return;
    const previous = this.camera.aspect; this.camera.aspect = width / height; this.camera.updateProjectionMatrix(); this.renderer?.setSize(width, height);
    if (Math.abs(previous - this.camera.aspect) > .2) this.fitCamera();
  }

  async openFiles(files: File[]): Promise<void> {
    if (this.uploading) { this.notify('保存が終わってから次のファイルを追加してください。'); return; }
    for (const file of files) {
      if (!/\.(stl|step|stp|glb)$/i.test(file.name)) { this.notify('STL・STEP・GLBファイル（.stl / .step / .stp / .glb）を選んでください。'); continue; }
      if (file.size > this.library.limits.maxFileBytes) { this.notify('50 MB以下のSTL・STEP・GLBファイルを選んでください。'); continue; }
      if (this.library.models.length + this.pending.length >= this.library.limits.maxModels) { this.notify('保存できるモデル数の上限に達しました。'); break; }
      let local: ModelRecord | null = null;
      this.uploading++; this.status.textContent = 'モデルを読み込み中…';
      try {
        if(/\.(step|stp)$/i.test(file.name)){
          this.status.textContent='STEPをアップロード・変換中… 部品構成を読み取っています';
          if(!this.connected)await this.library.refresh();
          const saved=await this.library.save(file);
          await this.show(saved);
          this.status.textContent=`STEPを保存しました · ${saved.partCount??1} 部品`;
          continue;
        }
        const parsed = await (/\.glb$/i.test(file.name)?loadGLB:loadSTL)(await file.arrayBuffer());
        const thumbnail = await this.thumbnail(parsed);
        local = { id: `pending-${crypto.randomUUID()}`, name: file.name, createdAt: new Date().toISOString(), size: file.size, dimensions: parsed.dimensions, triangles: parsed.triangles, modelUrl: URL.createObjectURL(file), thumbnailUrl: URL.createObjectURL(thumbnail) };
        this.cache.set(local.id, parsed); this.pending.unshift(local); ++this.selectionVersion; this.display(local, parsed);
        this.status.textContent = parsed.triangles > 100_000 ? '表示用モデルを軽量化中… プレビューは操作できます' : '保存中… プレビューは操作できます';
        if (!this.connected) await this.library.refresh();
        const saved = await this.library.save(file, thumbnail);
        this.cache.set(saved.id, parsed); this.cache.delete(local.id);
        this.pending = this.pending.filter((item) => item.id !== local!.id);
        if (this.active?.id === local.id) { this.active = saved; this.onModelSelected?.(saved, parsed); }
        URL.revokeObjectURL(local.modelUrl); if (local.thumbnailUrl) URL.revokeObjectURL(local.thumbnailUrl);
        if (saved.optimization && saved.optimization.triangles < parsed.triangles) {
          // Swap the immediate full-detail local preview for the server-generated display copy.
          this.cache.delete(saved.id);
          if (this.active?.id === saved.id) await this.show(saved);
          if (this.parsed !== parsed) disposeParsed(parsed);
          else this.cache.set(saved.id, parsed);
        }
        this.status.textContent = (this.library.storage === 'cloud' ? 'クラウドに保存しました' : 'この開発サーバーに保存しました') + (saved.optimization && saved.optimization.triangles < saved.triangles ? ' · 表示用に軽量化済み' : saved.optimization?.status === 'failed' ? ' · 軽量化できなかったため元の形状を表示' : ''); this.renderLibrary();
      } catch (error) {
        this.status.textContent = local ? '保存できませんでした · モデルはプレビューのみ' : 'もう一度ファイルを選んでください';
        this.notify(error instanceof Error ? error.message : '保存できませんでした。接続を確認してください。');
      } finally { this.uploading--; }
    }
  }

  private async thumbnail(parsed: ParsedModel): Promise<Blob> {
    if (!this.renderer) throw new Error('3D表示を開始できないため、モデルを保存できません。');
    const scene = new Scene(); scene.background = new Color(0xf2f4f4);
    scene.add(new HemisphereLight(0xffffff, 0x829095, 3.3)); const light = new DirectionalLight(0xffffff, 3.4); light.position.set(4, 7, 5); scene.add(light);
    const mesh = parsed.scene ? cloneModelScene(parsed.scene) : new Mesh(parsed.geometry, this.material); scene.add(mesh);
    const sphere = parsed.geometry.boundingSphere!; const camera = new PerspectiveCamera(34, 1, Math.max(sphere.radius / 100, .000001), Math.max(sphere.radius * 100, 100));
    const distance = sphere.radius / Math.sin(17 * Math.PI / 180) * 1.15; camera.position.set(distance * .65, distance * .43, distance * .65); camera.lookAt(0, 0, 0);
    const renderer = this.renderer; const previous = renderer.getPixelRatio(); const width = this.canvasHost.clientWidth, height = this.canvasHost.clientHeight;
    renderer.setPixelRatio(1); renderer.setSize(360, 360, false); renderer.render(scene, camera);
    const blob = await new Promise<Blob>((resolve, reject) => renderer.domElement.toBlob((result) => result ? resolve(result) : reject(new Error('サムネイルを作成できませんでした。')), 'image/png'));
    renderer.setPixelRatio(previous); renderer.setSize(width, height); scene.clear();
    if(parsed.scene)disposeModelScene(mesh);
    return blob;
  }

  private renderLibrary(): void {
    const records = [...this.pending, ...this.library.models];
    this.host.querySelector('.model-count')!.textContent = String(records.length).padStart(2, '0');
    const storage = this.host.querySelector('.storage-text')!;
    storage.textContent = this.connected ? this.library.storage === 'cloud' ? 'クラウドと同期' : '開発サーバーに保存' : 'ライブラリに接続中';
    this.host.querySelector('.storage-line')!.classList.toggle('is-connected', this.connected);
    this.list.replaceChildren();
    if (!records.length) {
      const empty = document.createElement('div'); empty.className = 'library-empty'; empty.innerHTML = `<div>${cubeIcon}</div><p>まだモデルがありません</p><span>追加したモデルが<br>ここに並びます。</span>`; this.list.append(empty); return;
    }
    records.forEach((record, index) => {
      const card = document.createElement('button'); card.type = 'button'; card.className = `model-card${record.id === this.active?.id ? ' selected' : ''}`; card.setAttribute('aria-pressed', String(record.id === this.active?.id));
      const imageHost = document.createElement('div'); imageHost.className = 'model-card-image';
      if (record.thumbnailUrl) { const image = document.createElement('img'); image.src = record.thumbnailUrl; image.alt = ''; image.loading = 'lazy'; imageHost.append(image); } else imageHost.innerHTML = cubeIcon;
      const indexLabel = document.createElement('span'); indexLabel.className = 'card-index'; indexLabel.textContent = String(index + 1).padStart(2, '0'); imageHost.append(indexLabel);
      const info = document.createElement('div'); info.className = 'model-card-info';
      const name = document.createElement('span'); name.className = 'card-name'; name.textContent = record.name; name.title = record.name;
      const meta = document.createElement('span'); meta.className = 'card-meta'; meta.textContent = `${formatSize(record.size)}${record.optimization && record.optimization.size < record.size ? ` → ${formatSize(record.optimization.size)} · 軽量化済み` : record.id.startsWith('pending-') ? ' · 未保存' : record.format === 'step' ? ` · STEP · ${record.partCount??1} 部品` : record.format === 'glb' ? ' · GLB' : ' · STL'}`;
      info.append(name, meta); card.append(imageHost, info); card.addEventListener('click', () => void this.show(record)); this.list.append(card);
    });
  }

  private trimCache(): void {
    if (this.cache.size <= 6) return;
    for (const [id, parsed] of this.cache) {
      if (this.cache.size <= 6) break;
      if (id === this.active?.id || this.pending.some((item) => item.id === id)) continue;
      disposeParsed(parsed); this.cache.delete(id);
    }
  }

  private setStorageOffline(): void { this.host.querySelector('.storage-text')!.textContent = '接続を確認してください'; this.host.querySelector('.storage-line')!.classList.remove('is-connected'); }

  private openShare(): void {
    const url = new URL(location.href); url.hash = ''; url.search = '';
    const shareURL = url.toString();
    const launch = this.dialog.querySelector('.web-launch') as HTMLAnchorElement;
    launch.href = `https://www.oculus.com/open_url/?url=${encodeURIComponent(shareURL)}`;
    this.dialog.querySelector('.share-url')!.textContent = shareURL;
    const note = this.dialog.querySelector('.share-note')!;
    note.textContent = /^(localhost|127\.0\.0\.1)$/.test(url.hostname) || url.protocol !== 'https:' ? 'Questからは、同じWi-FiのHTTPS URLまたは公開URLで開いてください。' : 'Quest上では「ブラウザで表示」を押してください。';
    void QRCode.toCanvas(this.dialog.querySelector('.qr-code')!, shareURL, { width: 128, margin: 1, color: { dark: '#273638', light: '#ffffff' } });
    this.dialog.showModal();
  }

  private async copyURL(): Promise<void> {
    try { const url = new URL(location.href); url.hash = ''; url.search = ''; await navigator.clipboard.writeText(url.toString()); const button = this.dialog.querySelector('.copy-button')!; button.textContent = 'コピーしました ✓'; setTimeout(() => { button.innerHTML = 'URLをコピー <span>↗</span>'; }, 2000); }
    catch { this.notify('URLをコピーできませんでした。アドレスバーのURLをコピーしてください。'); }
  }

  dispose(): void {
    this.gallery.dispose();
    this.playback?.dispose();if(this.model&&this.parsed?.scene)disposeModelScene(this.model);
    this.disposed = true; cancelAnimationFrame(this.requestId); clearInterval(this.pollTimer); clearTimeout(this.toastTimer); this.resizeObserver.disconnect();
    for(const part of this.assemblyParts)part.mesh.geometry.dispose();
    for (const model of new Set(this.cache.values())) disposeParsed(model);
    this.material.dispose(); this.lines?.geometry.dispose(); (this.lines?.material as LineBasicMaterial | undefined)?.dispose();
    if (this.shadow) { this.shadow.geometry.dispose(); const material = this.shadow.material as MeshBasicMaterial; material.map?.dispose(); material.dispose(); }
    this.pending.forEach((record) => { URL.revokeObjectURL(record.modelUrl); if (record.thumbnailUrl) URL.revokeObjectURL(record.thumbnailUrl); });
    this.renderer?.dispose(); this.host.remove();
  }
}



