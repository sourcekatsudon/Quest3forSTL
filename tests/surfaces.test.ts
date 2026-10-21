import {test,expect} from 'vitest';
import {tableLift} from '../src/surfaces';
const table={min:{x:-1,y:.72,z:-1},max:{x:1,y:.75,z:1}};
test('desk stops held or fast-falling geometry crossing from above',()=>{
 expect(tableLift(.9,{min:{x:0,y:.6,z:0},max:{x:.1,y:.8,z:.1}},table)).toBeCloseTo(.152);
 expect(tableLift(.9,{min:{x:0,y:.2,z:0},max:{x:.1,y:.3,z:.1}},table)).toBeCloseTo(.552);
});
test('objects underneath or outside a desk are not teleported onto it',()=>{
 expect(tableLift(.2,{min:{x:0,y:.1,z:0},max:{x:.1,y:.3,z:.1}},table)).toBe(0);
 expect(tableLift(.9,{min:{x:2,y:.5,z:0},max:{x:3,y:.7,z:.1}},table)).toBe(0);
});
