export interface PhotoRecord {
 id: string;
 createdAt: string;
 width: number;
 height: number;
 size: number;
 imageUrl: string;
 content: 'virtual-scene';
}
export const photoLimits = { maxBytes: 3 * 1024 * 1024, maxPhotos: 200 } as const;
