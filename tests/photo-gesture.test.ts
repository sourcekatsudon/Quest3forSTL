import { describe, expect, it } from 'vitest';
import { Vector3 } from '@iwsdk/core';
import { FrameGesture, FrameShutter, type FrameHand } from '../src/photo-gesture';
const p=(x:number,y:number,z=-.4)=>new Vector3(x,y,z);
function frame():[FrameHand,FrameHand]{return [
 {indexBase:p(-.07,-.07),index:p(-.07,.035),thumbBase:p(-.055,-.07),thumb:p(.035,-.07)},
 {indexBase:p(.07,.07),index:p(.07,-.035),thumbBase:p(.055,.07),thumb:p(-.035,.07)},
];}
describe('photo frame gesture',()=>{
 it('accepts opposed L shapes with reasonable tracking noise and rotation',()=>{
  const [l,r]=frame(),detector=new FrameGesture();expect(detector.matches(l,r)).toBe(true);
  for(const hand of [l,r])for(const point of Object.values(hand))point.applyAxisAngle(p(0,0,0).set(0,0,1),.3).add(p(.008,-.005,0));
  expect(detector.matches(l,r)).toBe(true);
 });
 it('rejects pinch, hands behind the head, non-coplanar hands and parallel fingers',()=>{
  const detector=new FrameGesture();let [l,r]=frame();l.thumb.copy(l.index);expect(detector.matches(l,r)).toBe(false);
  [l,r]=frame();r.index.z=.2;expect(detector.matches(l,r)).toBe(false);
  [l,r]=frame();r.thumb.z-=.15;expect(detector.matches(l,r)).toBe(false);
  [l,r]=frame();r.index.copy(r.indexBase).add(p(0,.1,0));expect(detector.matches(l,r)).toBe(false);
 });
 it('requires a continuous hold and release before another shutter',()=>{
  const shutter=new FrameShutter();let photos=0;
  for(let i=0;i<10;i++)photos+=Number(shutter.update(true,.05));expect(photos).toBe(0);
  shutter.update(false,.05);
  for(let i=0;i<100;i++)photos+=Number(shutter.update(true,.05));expect(photos).toBe(1);
  for(let i=0;i<9;i++)shutter.update(false,.05);
  for(let i=0;i<60;i++)photos+=Number(shutter.update(true,.05));expect(photos).toBe(2);
  shutter.reset();for(let i=0;i<80;i++)photos+=Number(shutter.update(true,.05));expect(photos).toBe(2);
 });
 it('waits three full seconds for the audible 3, 2, 1 countdown',()=>{
  const shutter=new FrameShutter();
  for(let i=0;i<29;i++)expect(shutter.update(true,.1)).toBe(false);
  expect(shutter.update(true,.1)).toBe(true);
  for(let i=0;i<40;i++)expect(shutter.update(true,.1)).toBe(false);
 });
});

