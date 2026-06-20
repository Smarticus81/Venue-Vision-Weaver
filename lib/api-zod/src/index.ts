import {
  AddVenueMediaBody as AddVenueMediaBodySchema,
  CreateSessionBody as CreateSessionBodySchema,
  CreateVenueBody as CreateVenueBodySchema,
  ListVenueMediaResponse as ListVenueMediaResponseSchema,
  ListGalleryStylesResponse as ListGalleryStylesResponseSchema,
} from "./generated/api";

import type {
  AddVenueMediaBody as AddVenueMediaBodyType,
  CreateSessionBody as CreateSessionBodyType,
  CreateVenueBody as CreateVenueBodyType,
  ListVenueMediaResponse as ListVenueMediaResponseType,
  ListGalleryStylesResponse as ListGalleryStylesResponseType,
  ErrorEnvelope,
  GeneratedAsset,
  GeneratedAssetAssetType,
  HealthStatus,
  ListSessionsResponse,
  SessionDetailResponse,
  SessionDetailResponseStatus,
  SessionResponse,
  SessionResponseStatus,
  SessionSummary,
  SessionSummaryStatus,
  UploadUrlRequest,
  UploadUrlResponse,
  OwnerSessionResponse,
  VenueDashboardResponse,
  VenueMediaItem,
  VenuePublicResponse,
  VenueResponse,
  VenueStatsResponse,
  GalleryStyleSummary,
} from "./generated/types";

// Wildcard export everything from api (explicitly overriding the merged ones below)
export * from "./generated/api";

// Explicitly export merged values and types to resolve shadowing
export const AddVenueMediaBody = AddVenueMediaBodySchema;
export type AddVenueMediaBody = AddVenueMediaBodyType;

export const CreateSessionBody = CreateSessionBodySchema;
export type CreateSessionBody = CreateSessionBodyType;

export const CreateVenueBody = CreateVenueBodySchema;
export type CreateVenueBody = CreateVenueBodyType;

export const ListVenueMediaResponse = ListVenueMediaResponseSchema;
export type ListVenueMediaResponse = ListVenueMediaResponseType;

export const ListGalleryStylesResponse = ListGalleryStylesResponseSchema;
export type ListGalleryStylesResponse = ListGalleryStylesResponseType;

export type {
  ErrorEnvelope,
  GeneratedAsset,
  GeneratedAssetAssetType,
  HealthStatus,
  ListSessionsResponse,
  SessionDetailResponse,
  SessionDetailResponseStatus,
  SessionResponse,
  SessionResponseStatus,
  SessionSummary,
  SessionSummaryStatus,
  UploadUrlRequest,
  UploadUrlResponse,
  OwnerSessionResponse,
  VenueDashboardResponse,
  VenueMediaItem,
  VenuePublicResponse,
  VenueResponse,
  VenueStatsResponse,
  GalleryStyleSummary,
};
