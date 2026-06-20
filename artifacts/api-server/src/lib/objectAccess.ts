export function canReadVenueMediaReference(params: {
  publicVenueSlug?: string | null;
  venueSlug: string;
  ownerEmail?: string | null;
  venueOwnerEmail?: string | null;
}): boolean {
  if (params.publicVenueSlug && params.publicVenueSlug === params.venueSlug) {
    return true;
  }

  const ownerEmail = params.ownerEmail?.toLowerCase();
  const venueOwnerEmail = params.venueOwnerEmail?.toLowerCase();
  return Boolean(ownerEmail && venueOwnerEmail && ownerEmail === venueOwnerEmail);
}
