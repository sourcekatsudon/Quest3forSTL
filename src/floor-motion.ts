/** Only vertical gravity and the calibrated local-floor plane are active. */
export function floorMotion(bottom:number,velocity:number,gravity:boolean,held:boolean,delta:number,result={displacement:0,velocity:0}){
 const dt=Math.max(0,Math.min(.05,delta));
 let next=gravity&&!held?velocity-9.81*dt:0;
 let displacement=gravity&&!held?next*dt:0;
 if(bottom+displacement<0){displacement=-bottom;next=0;}
 result.displacement=displacement;result.velocity=next;return result;
}
