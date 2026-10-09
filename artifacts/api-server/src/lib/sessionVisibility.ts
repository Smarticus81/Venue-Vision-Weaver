type GalleryAssetVisibilityInput = {
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

/**
 * Hold persisted when a gallery turns ready but must wait for the owner. A
 * sample is never held (only the owner has its link); a venue that reviews
 * every gallery, or a frame the quality judge could not check, holds it.
 * Other delivery outcomes (no couple email, a failed send) do not hide the
 * gallery from its own share link.
 */
export type PersistedDeliveryHold = "review_before_send" | "unjudged_frames";

export function persistedDeliveryHold(input: {
  kind: string | null | undefined;
  reviewBeforeSend: boolean | null | undefined;
  needsReview: boolean;
}): PersistedDeliveryHold | null {
  if (input.kind === "sample") return null;
  if (input.reviewBeforeSend) return "review_before_send";
  if (input.needsReview) return "unjudged_frames";
  return null;
}

/** The share link serves a gallery only once it is ready and no owner hold is set. */
export function canExposeGeneratedAssetsToSharePage(status: string, deliveryHoldReason?: string | null): boolean {
  return status === "ready" && !deliveryHoldReason;
}

export function canReadGeneratedAssetWithShareToken(
  status: string,
  assets: GalleryAssetVisibilityInput[],
  deliveryHoldReason?: string | null,
): boolean {
  return canExposeGeneratedAssetsToSharePage(status, deliveryHoldReason) && hasCompletePublicGalleryAssets(assets);
}
