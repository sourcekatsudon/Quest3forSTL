/** Short camera cues synthesized locally, with no audio downloads. */
export class PhotoSound {
 private context:AudioContext|null=null;
 private output:GainNode|null=null;
 private shutterBuffer:AudioBuffer|null=null;
 private voices=new Set<AudioScheduledSourceNode>();
 private disposed=false;
 unlock(){
  if(this.disposed)return;
  try{
   if(!this.context){
    const context=new AudioContext();this.context=context;
    this.output=context.createGain();this.output.gain.value=.3;this.output.connect(context.destination);
    const buffer=context.createBuffer(1,Math.ceil(context.sampleRate*.22),context.sampleRate),data=buffer.getChannelData(0);
    // Two short mechanical clicks, with the second slightly softer.
    for(let i=0;i<data.length;i++){
     const t=i/context.sampleRate;
     const envelope=t<.065?Math.exp(-t*65):t>=.095?Math.exp(-(t-.095)*55)*.65:0;
     data[i]=(Math.random()*2-1)*envelope;
    }
    this.shutterBuffer=buffer;
   }
   if(this.context.state==='suspended')void this.context.resume().catch(()=>{});
  }catch{/* Audio must never prevent taking or saving a photo. */}
 }
 countdown(value:number){
  const context=this.context;if(!context||context.state!=='running'||!this.output)return;
  const tone=context.createOscillator(),gain=context.createGain(),now=context.currentTime;
  tone.frequency.value=value===1?1046.5:880;
  gain.gain.setValueAtTime(0,now);gain.gain.linearRampToValueAtTime(.24,now+.008);
  gain.gain.setValueAtTime(.24,now+.065);gain.gain.linearRampToValueAtTime(0,now+.1);
  tone.connect(gain);gain.connect(this.output);this.track(tone,gain);
  tone.start(now);tone.stop(now+.105);
 }
 shutter(){
  const context=this.context;if(!context||context.state!=='running'||!this.output||!this.shutterBuffer)return;
  const click=context.createBufferSource(),filter=context.createBiquadFilter();
  filter.type='highpass';filter.frequency.value=650;
  click.buffer=this.shutterBuffer;click.connect(filter);filter.connect(this.output);this.track(click,filter);click.start();
 }
 private track(voice:AudioScheduledSourceNode,output:AudioNode){
  this.voices.add(voice);voice.onended=()=>{voice.disconnect();output.disconnect();this.voices.delete(voice);};
 }
 cancel(){for(const voice of this.voices){try{voice.stop();}catch{}voice.disconnect();}this.voices.clear();}
 dispose(){this.disposed=true;this.cancel();if(this.context)void this.context.close().catch(()=>{});this.context=null;this.output=null;this.shutterBuffer=null;}
}
