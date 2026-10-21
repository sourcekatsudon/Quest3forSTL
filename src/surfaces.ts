/** Conservative contact using an oriented model's world AABB and a detected table's world bounds. */
export interface Bounds {min:{x:number;y:number;z:number};max:{x:number;y:number;z:number}}
export function tableLift(previousBottom:number,bounds:Bounds,surface:Bounds):number{
 const height=surface.max.y;
 if(bounds.max.x<surface.min.x||bounds.min.x>surface.max.x||bounds.max.z<surface.min.z||bounds.min.z>surface.max.z)return 0;
 // Only catch crossings from above; objects deliberately underneath remain underneath.
 return previousBottom>=height-.025&&bounds.min.y<height?height-bounds.min.y+.002:0;
}
