import {expect,it} from 'vitest';
import {floorMotion} from '../src/floor-motion';
it('gravity falls to the floor without a table or another model in the calculation',()=>{
 let bottom=1.2,velocity=0;
 const output={displacement:0,velocity:0};
 for(let i=0;i<180;i++){floorMotion(bottom,velocity,true,false,1/72,output);bottom+=output.displacement;velocity=output.velocity;expect(bottom).toBeGreaterThanOrEqual(0);}
 expect(bottom).toBe(0);expect(velocity).toBe(0);
});
it('gravity off and held objects stay put; the floor also stops a held object below zero',()=>{
 expect(floorMotion(.2,-3,false,false,.016)).toEqual({displacement:0,velocity:0});
 expect(floorMotion(.2,-3,true,true,.016)).toEqual({displacement:0,velocity:0});
 expect(floorMotion(-.02,0,false,true,.016)).toEqual({displacement:.02,velocity:0});
});
