import { Vector3 } from '@iwsdk/core';

/** Points are expressed in the viewer's local space, in metres. */
export interface FrameHand { indexBase: Vector3; index: Vector3; thumbBase: Vector3; thumb: Vector3 }
export class FrameGesture {
 private li=new Vector3();private lt=new Vector3();private ri=new Vector3();private rt=new Vector3();
 private inView(point:Vector3){return point.z<=-.15&&point.z>=-.85&&Math.abs(point.x)<=.5&&Math.abs(point.y)<=.4;}
 private open(hand:FrameHand){return hand.index.distanceTo(hand.thumb)>=.055&&this.inView(hand.index)&&this.inView(hand.thumb);}
 matches(left: FrameHand, right: FrameHand): boolean {
  // Open L shapes on opposing corners. Pinches and ordinary two-hand scaling
  // cannot qualify because each thumb must stay separated from its index tip.
  if(!this.open(left)||!this.open(right))return false;
  const spread=left.indexBase.distanceTo(right.indexBase);
  if (spread<.09||spread>.32) return false;
  if (Math.max(left.index.z,left.thumb.z,right.index.z,right.thumb.z)-Math.min(left.index.z,left.thumb.z,right.index.z,right.thumb.z)>.075) return false;
  this.li.subVectors(left.index,left.indexBase);this.lt.subVectors(left.thumb,left.thumbBase);
  this.ri.subVectors(right.index,right.indexBase);this.rt.subVectors(right.thumb,right.thumbBase);
  if(this.li.length()<.035||this.ri.length()<.035||this.lt.length()<.025||this.rt.length()<.025)return false;
  this.li.normalize();this.lt.normalize();this.ri.normalize();this.rt.normalize();
  if(Math.abs(this.li.z)>.55||Math.abs(this.ri.z)>.55||Math.abs(this.lt.z)>.55||Math.abs(this.rt.z)>.55)return false;
  // Thumb phalanges do not form an anatomical right angle even in an L pose.
  if(Math.abs(this.li.dot(this.lt))>.8||Math.abs(this.ri.dot(this.rt))>.8)return false;
  if(this.li.dot(this.ri)>-.55||this.lt.dot(this.rt)>-.55)return false;
  return left.index.distanceTo(right.thumb)<.095&&left.thumb.distanceTo(right.index)<.095;
 }
}
export class FrameShutter {
 progress=0;private latched=false;private released=0;
 update(valid:boolean,delta:number):boolean {
  const dt=Math.max(0,Math.min(delta,.1));
  if(!valid){this.progress=0;this.released+=dt;if(this.released>=.4)this.latched=false;return false;}
  this.released=0;if(this.latched)return false;
  this.progress=Math.min(1,this.progress+dt/1.2);
  if(this.progress<1)return false;
  this.latched=true;this.progress=0;return true;
 }
 reset(){this.progress=0;this.released=0;this.latched=true;}
}
