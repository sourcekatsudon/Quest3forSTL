import { createComponent, defineComponents, Types } from '@iwsdk/core';
export const RoomModel = createComponent('RoomModel', {
 assetId: { type: Types.String, default: '' },
 homePosition: { type: Types.Vec3, default: [0,1.2,-1.15] },
 homeScale: { type: Types.Float32, default: 1 },
 colliderScale: { type: Types.Float32, default: 1 },
 extents: { type: Types.Vec3, default: [.1,.1,.1] },
 triangles: { type: Types.Int32, default: 0 },
 explosion: { type: Types.Float32, default: 0 },
 partCount: { type: Types.Int32, default: 1 },
 explosionOpen: { type: Types.Boolean, default: false },
 gravity: { type: Types.Boolean, default: false },
 materialPreset: { type: Types.String, default: 'plastic' },
 tint: { type: Types.String, default: '#b4b9bc' },
 animationCount: { type: Types.Int32, default: 0 },
 animationPlaying: { type: Types.Boolean, default: false },
});
export const RoomInputVisuals = createComponent('RoomInputVisuals', {
 handedness: { type: Types.String, default: 'right' },
 mode: { type: Types.String, default: 'none' },
});
export const RoomMeasurementMode = createComponent('RoomMeasurementMode', {
 active: { type: Types.Boolean, default: false },
 stage: { type: Types.String, default: 'ready' },
 count: { type: Types.Int32, default: 0 },
 hit: { type: Types.Boolean, default: false },
 hitPoint: { type: Types.Vec3, default: [0,0,0] },
});
export const RoomDimension = createComponent('RoomDimension', {
 model: { type: Types.Entity, default: null },
 start: { type: Types.Vec3, default: [0,0,0] },
 end: { type: Types.Vec3, default: [0,0,0] },
 millimetres: { type: Types.Float32, default: 0 },
});
export default defineComponents([RoomModel, RoomInputVisuals, RoomMeasurementMode, RoomDimension]);
