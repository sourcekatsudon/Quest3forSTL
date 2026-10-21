import type { PhotoRecord } from '../shared/photos';

export async function uploadPhoto(id:string,blob:Blob):Promise<PhotoRecord>{
 const response=await fetch(`/api/photos?id=${id}`,{method:'POST',headers:{'Content-Type':blob.type},body:blob,signal:AbortSignal.timeout(45000)});
 if(!response.ok){const data=await response.json().catch(()=>null);throw new Error(data?.error||'写真を保存できませんでした。再保存してください。');}
 const data=await response.json() as {photo:PhotoRecord};
 window.dispatchEvent(new Event('room-photo-saved'));return data.photo;
}
export class PhotoGallery {
 private dialog:HTMLDialogElement;private list:HTMLElement;private status:HTMLElement;
 private loading=false;private timer=0;
 private saved=()=>{if(this.dialog.open)void this.refresh();};
 constructor(host:HTMLElement){
  this.dialog=document.createElement('dialog');this.dialog.className='photo-dialog';
  this.dialog.innerHTML='<div class="photo-heading"><div><span class="section-kicker">YOUR PHOTOS</span><h2>撮影した写真</h2></div><button type="button" class="photo-close" aria-label="写真を閉じる">×</button></div><p class="photo-description">両手の親指と人差し指で四角を作り、約1秒保持すると撮影します。<br>3D表示のみを保存します。実際の部屋は写りません。</p><p class="photo-sharing">写真はこの共通ライブラリに保存され、同じURLを開いた人と共有されます。</p><div class="photo-toolbar"><span class="photo-status" role="status" aria-live="polite"></span><button type="button" class="photo-refresh">更新</button></div><div class="photo-grid"></div>';
  host.append(this.dialog);this.list=this.dialog.querySelector('.photo-grid')!;this.status=this.dialog.querySelector('.photo-status')!;
  this.dialog.querySelector('.photo-close')!.addEventListener('click',()=>this.dialog.close());
  this.dialog.querySelector('.photo-refresh')!.addEventListener('click',()=>void this.refresh());
  this.dialog.addEventListener('click',event=>{if(event.target===this.dialog)this.dialog.close();});
  this.dialog.addEventListener('close',()=>clearInterval(this.timer));
  window.addEventListener('room-photo-saved',this.saved);
 }
 open(){if(!this.dialog.open)this.dialog.showModal();void this.refresh();clearInterval(this.timer);this.timer=window.setInterval(()=>{if(!document.hidden)void this.refresh();},12000);}
 async refresh(){
  if(this.loading)return;this.loading=true;this.status.textContent='写真を読み込み中…';
  try{
   const response=await fetch('/api/photos',{cache:'no-store'});if(!response.ok)throw new Error('写真を読み込めませんでした。「更新」で再試行できます。');
   const {photos}=await response.json() as {photos:PhotoRecord[]};const nodes:HTMLElement[]=[];
   for(const photo of photos){
    const card=document.createElement('article');card.className='photo-card';
    const link=document.createElement('a');link.href=`/api/photos?id=${encodeURIComponent(photo.id)}`;link.target='_blank';link.rel='noopener';link.title='写真を大きく表示';
    const image=document.createElement('img');image.src=link.href;image.alt='Questで撮影した3D表示';image.loading='lazy';image.width=photo.width;image.height=photo.height;link.append(image);
    const caption=document.createElement('p');caption.textContent=new Date(photo.createdAt).toLocaleString('ja-JP');
    const download=document.createElement('a');download.href=link.href;download.download=`Quest-${photo.createdAt.replace(/[:.]/g,'-')}.jpg`;download.textContent='ダウンロード';
    card.append(link,caption,download);nodes.push(card);
   }
   this.list.replaceChildren(...nodes);this.status.textContent=photos.length?`${photos.length}枚 · 写真を選ぶと拡大できます`:'写真はまだありません。Questで四角のジェスチャを試してください。';
  }catch(error){this.status.textContent=error instanceof Error?error.message:'写真を読み込めませんでした。';}
  finally{this.loading=false;}
 }
 dispose(){clearInterval(this.timer);window.removeEventListener('room-photo-saved',this.saved);this.dialog.remove();}
}
