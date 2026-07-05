export function canReadVenueMediaReference(params: {
  publicVenueSlug?: string | null;
  venueSlug: string;
  callerOrgId?: number | null;
  venueOrganizationId?: number | null;
}): boolean {
  if (params.publicVenueSlug && params.publicVenueSlug === params.venueSlug) {
    return true;
  }

  return Boolean(
    params.callerOrgId != null &&
      params.venueOrganizationId != null &&
      params.callerOrgId === params.venueOrganizationId,
  );
}
