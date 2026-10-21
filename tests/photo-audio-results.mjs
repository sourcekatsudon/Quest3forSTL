import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
export default async function({frame,page,workspaceRoot}){
 const result=await (frame??page).evaluate(()=>{
  const trace=window.__photoAudio;trace.stop();
  return {events:trace.events.map(event=>({...event,maxRms:Math.max(0,...trace.samples.filter(s=>s.time>=event.time&&s.time<event.time+.24).map(s=>s.rms))})),samples:trace.samples.length};
 });
 const shutters=result.events.map((event,index)=>event.cue==='shutter'?index:-1).filter(index=>index>=0);
 assert.equal(shutters.length,2,'initial capture and failed upload each shutter once; retry is silent');
 for(const index of shutters){
  const countdown=result.events.slice(index-3,index);assert.deepEqual(countdown.map(e=>e.cue),[3,2,1]);
  for(let i=1;i<3;i++)assert.ok(countdown[i].time-countdown[i-1].time>.85&&countdown[i].time-countdown[i-1].time<1.2,'countdown sounds are one second apart');
  assert.ok(result.events[index].time-countdown[2].time>.85,'shutter follows the final second');
  for(const event of [...countdown,result.events[index]]){assert.equal(event.state,'running');assert.ok(event.maxRms>.005,'actual PCM audio has nonzero audible energy');}
 }
 await writeFile(`${workspaceRoot}/artifacts/photo-audio-results.json`,JSON.stringify({passed:true,...result},null,2));
 return {passed:true,...result};
}
