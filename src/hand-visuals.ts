import { AnimatedHand, createSystem, Group, Mesh, MeshBasicMaterial, SkinnedMesh } from '@iwsdk/core';
import { RoomInputVisuals } from './components';
import { forearmGhost } from './scene-assets/forearm.scene-asset';

const ghostMaterial = new MeshBasicMaterial({
 color: '#b1e1ff', transparent: true, opacity: .24,
 depthWrite: false, depthTest: false, toneMapped: false,
});

// Keep the SDK's joint animation, pinch input, and automatic source selection.
// Unlike the default outline-only hand, this also shows the translucent surface.
export class RoomGhostHand extends AnimatedHand {
 static assetKeyPrefix = 'room-ghost-hand';
 static assetProfileId = 'generic-hand';
 init() {
  this.model.traverse(node => {
   if (node instanceof Mesh) {
    node.material = ghostMaterial;
    node.frustumCulled = false;
    node.renderOrder = 1001;
   }
  });
  const wrist = this.model.getObjectByName('wrist');
  if (wrist) wrist.add(forearmGhost.clone(true));
  // Use the native asset at its actual scale; no enlarged hand offset.
  const mesh = this.model.getObjectByProperty('type', 'SkinnedMesh') as SkinnedMesh | undefined;
  if (mesh) mesh.frustumCulled = false;
 }
}

export class RoomInputVisualSystem extends createSystem({ visuals: { required: [RoomInputVisuals] } }) {
 init() {
  for (const side of ['left', 'right'] as const) {
   this.input.xr.visualAdapters.hand[side].updateVisualImplementation(RoomGhostHand);
   const root = new Group(); root.name = `Room input ${side}`;
   this.world.createTransformEntity(root).addComponent(RoomInputVisuals, { handedness: side });
  }
 }
 update() {
  const manager = this.world.renderer.xr;
  const frame = manager.getFrame();
  const space = manager.getReferenceSpace();
  for (const entity of this.queries.visuals.entities) {
   const side = entity.getValue(RoomInputVisuals, 'handedness') as 'left' | 'right';
   const source = manager.isPresenting ? this.input.xr.getPrimaryInputSource(side) : undefined;
   const wrist = source?.hand?.get('wrist');
   const tracked = !!(wrist && frame && space && frame.getJointPose?.(wrist, space));
   const visual = this.input.xr.visualAdapters.hand[side].visual;
   if (visual) visual.model.visible = tracked;
   const mode = source ? (source.hand ? (tracked ? 'hand' : 'none') : 'controller') : 'none';
   if (entity.getValue(RoomInputVisuals, 'mode') !== mode) entity.setValue(RoomInputVisuals, 'mode', mode);
  }
 }
}
