export type GalleryAssetVisibilityInput = {
  assetType: string;
  displayOrder: number;
};

const REQUIRED_PUBLIC_STILL_DISPLAY_ORDERS = [1, 2, 3, 4] as const;

export function hasCompletePublicGalleryAssets(
  assets: GalleryAssetVisibilityInput[],
): boolean {
  if (assets.length !== REQUIRED_PUBLIC_STILL_DISPLAY_ORDERS.length + 1) return false;

  const stills = assets.filter((asset) => asset.assetType === "image");
  const motionReels = assets.filter(
    (asset) => asset.assetType === "video" && asset.displayOrder === 0,
  );
  if (stills.length !== REQUIRED_PUBLIC_STILL_DISPLAY_ORDERS.length) return false;
  if (motionReels.length !== 1) return false;

  const stillDisplayOrders = new Set(stills.map((asset) => asset.displayOrder));
  if (stillDisplayOrders.size !== stills.length) return false;

  const hasRequiredStills = REQUIRED_PUBLIC_STILL_DISPLAY_ORDERS.every((displayOrder) =>
    stillDisplayOrders.has(displayOrder),
  );
  return hasRequiredStills;
}

export function canExposeGeneratedAssetsToSharePage(status: string): boolean {
  return status === "ready";
}

export function canReadGeneratedAssetWithShareToken(
  status: string,
  assets: GalleryAssetVisibilityInput[],
): boolean {
  return canExposeGeneratedAssetsToSharePage(status) && hasCompletePublicGalleryAssets(assets);
}
