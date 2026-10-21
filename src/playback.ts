import { AnimationMixer, LoopRepeat, type Object3D } from '@iwsdk/core';

/** Each displayed instance owns its clock and bone/morph state. */
export class ModelPlayback {
 readonly mixer: AnimationMixer;
 readonly count: number;
 private disposed=false;
 constructor(readonly root:Object3D) {
  this.mixer=new AnimationMixer(root);
  const clips=root.animations.filter(clip=>clip.duration>0&&clip.tracks.length>0);
  this.count=clips.length;
  // Clips commonly represent alternate actions (walk/run). Play the first one
  // rather than blending unrelated actions together.
  if(clips[0])this.mixer.clipAction(clips[0]).setLoop(LoopRepeat,Infinity).play();
 }
 get playing(){return this.count>0&&this.mixer.timeScale>0&&!this.disposed;}
 setPlaying(playing:boolean){if(!this.disposed)this.mixer.timeScale=playing?1:0;}
 update(delta:number){if(!this.disposed&&this.playing)this.mixer.update(Math.min(Math.max(delta,0),.05));}
 dispose(){if(this.disposed)return;this.mixer.stopAllAction();this.mixer.uncacheRoot(this.root);this.disposed=true;}
}
