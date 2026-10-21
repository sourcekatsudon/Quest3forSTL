import { AssetType, defineAssets } from '@iwsdk/core';
import { forearmGhost } from './scene-assets/forearm.scene-asset';
export default defineAssets({
 'forearm-ghost': forearmGhost,
 'room-controls': {url:`${import.meta.env.BASE_URL}ui/controls.uikitml`,type:AssetType.UIKitML},
 'room-library': {url:`${import.meta.env.BASE_URL}ui/library.uikitml`,type:AssetType.UIKitML},
 'room-materials': {url:`${import.meta.env.BASE_URL}ui/materials.uikitml`,type:AssetType.UIKitML},
});
