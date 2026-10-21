export default async function({frame,page}){
 return (frame??page).evaluate(async()=>{
  const {world}=await import('/src/index.ts'),{RoomPhotoSystem}=await import('/src/photo-capture.ts'),{RoomPhotoCapture}=await import('/src/components.ts');
  const photo=world.getSystem(RoomPhotoSystem),sound=photo.sounds,context=sound.context;
  if(!context||context.state!=='running')throw new Error('XR launch click did not unlock audio');
  const events=[],samples=[],analyser=context.createAnalyser();analyser.fftSize=2048;sound.output.connect(analyser);
  const data=new Float32Array(analyser.fftSize);
  const timer=setInterval(()=>{analyser.getFloatTimeDomainData(data);let energy=0;for(const value of data)energy+=value*value;samples.push({time:context.currentTime,rms:Math.sqrt(energy/data.length)});},10);
  const oscillator=context.createOscillator.bind(context),buffer=context.createBufferSource.bind(context);
  function observe(node,cue){const start=node.start.bind(node);node.start=(...args)=>{events.push({cue:cue(),time:context.currentTime,state:context.state});return start(...args);};return node;}
  context.createOscillator=()=>observe(oscillator(),()=>photo.state.getValue(RoomPhotoCapture,'countdown'));
  context.createBufferSource=()=>observe(buffer(),()=> 'shutter');
  window.__photoAudio={events,samples,stop(){clearInterval(timer);sound.output.disconnect(analyser);analyser.disconnect();context.createOscillator=oscillator;context.createBufferSource=buffer;}};
  return {audioUnlocked:context.state==='running'};
 });
}
