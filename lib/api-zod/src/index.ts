import {
  AddVenueMediaBody as AddVenueMediaBodySchema,
  CreateSessionBody as CreateSessionBodySchema,
  CreateVenueBody as CreateVenueBodySchema,
  ListVenueMediaResponse as ListVenueMediaResponseSchema,
  ListGalleryStylesResponse as ListGalleryStylesResponseSchema,
  UpdateOrganizationBody as UpdateOrganizationBodySchema,
  SetSessionBookedBody as SetSessionBookedBodySchema,
  VetControlProspectBody as VetControlProspectBodySchema,
  OverrideControlProspectVettingBody as OverrideControlProspectVettingBodySchema,
  AddControlProspectFactBody as AddControlProspectFactBodySchema,
  SetControlOutreachSendingBody as SetControlOutreachSendingBodySchema,
} from "./generated/api";

import type {
  AddVenueMediaBody as AddVenueMediaBodyType,
  CreateSessionBody as CreateSessionBodyType,
  CreateVenueBody as CreateVenueBodyType,
  ListVenueMediaResponse as ListVenueMediaResponseType,
  ListGalleryStylesResponse as ListGalleryStylesResponseType,
  UpdateOrganizationBody as UpdateOrganizationBodyType,
  SetSessionBookedBody as SetSessionBookedBodyType,
  VetControlProspectBody as VetControlProspectBodyType,
  OverrideControlProspectVettingBody as OverrideControlProspectVettingBodyType,
  AddControlProspectFactBody as AddControlProspectFactBodyType,
  SetControlOutreachSendingBody as SetControlOutreachSendingBodyType,
  ErrorEnvelope,
  GeneratedAsset,
  GeneratedAssetAssetType,
  HealthStatus,
  OwnerSessionDetailResponse,
  SessionDetailResponse,
  SessionDetailResponseStatus,
  SessionResponse,
  SessionResponseStatus,
  SessionSummary,
  SessionSummaryStatus,
  UploadUrlRequest,
  UploadUrlResponse,
  OrganizationResponse,
  OrgCreditHistoryResponse,
  VenueDashboardResponse,
  VenueMediaItem,
  VenuePublicResponse,
  VenueResponse,
  GalleryStyleSummary,
  ReadinessStatus,
  TrialState,
  PricingConfig,
  TrialConfig,
  FoundingOffer,
  ProofAggregates,
  PublicConfig,
  GalleryEventBody,
  GalleryEventResponse,
  ImportWebsiteMediaBody,
  ImportWebsiteMediaResponse,
  FunnelEventBody,
  FunnelEventResponse,
  OutreachClaimResponse,
  ControlProspect,
  ControlProspectVetting,
  ControlProspectFact,
  ControlProspectEvidenceResponse,
  ControlCitedFact,
  ControlOutreachEmail,
  ControlOutreachEmailDetail,
  ControlOutreachSendingState,
  ControlDeliverabilityGuard,
  GrowthKpis,
  ControlGrowthResponse,
  ControlCopyVariant,
  ControlAdaptation,
  ControlDigest,
  ControlExperiment,
  ControlExperimentEvaluation,
  ControlCampaign,
  ControlPolicy,
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

export const UpdateOrganizationBody = UpdateOrganizationBodySchema;
export type UpdateOrganizationBody = UpdateOrganizationBodyType;

export const SetSessionBookedBody = SetSessionBookedBodySchema;
export type SetSessionBookedBody = SetSessionBookedBodyType;

export const VetControlProspectBody = VetControlProspectBodySchema;
export type VetControlProspectBody = VetControlProspectBodyType;

export const OverrideControlProspectVettingBody =
  OverrideControlProspectVettingBodySchema;
export type OverrideControlProspectVettingBody =
  OverrideControlProspectVettingBodyType;

export const AddControlProspectFactBody = AddControlProspectFactBodySchema;
export type AddControlProspectFactBody = AddControlProspectFactBodyType;

export const SetControlOutreachSendingBody =
  SetControlOutreachSendingBodySchema;
export type SetControlOutreachSendingBody = SetControlOutreachSendingBodyType;

export type {
  ErrorEnvelope,
  GeneratedAsset,
  GeneratedAssetAssetType,
  HealthStatus,
  OwnerSessionDetailResponse,
  SessionDetailResponse,
  SessionDetailResponseStatus,
  SessionResponse,
  SessionResponseStatus,
  SessionSummary,
  SessionSummaryStatus,
  UploadUrlRequest,
  UploadUrlResponse,
  OrganizationResponse,
  OrgCreditHistoryResponse,
  VenueDashboardResponse,
  VenueMediaItem,
  VenuePublicResponse,
  VenueResponse,
  GalleryStyleSummary,
  ReadinessStatus,
  TrialState,
  PricingConfig,
  TrialConfig,
  FoundingOffer,
  ProofAggregates,
  PublicConfig,
  GalleryEventBody,
  GalleryEventResponse,
  ImportWebsiteMediaBody,
  ImportWebsiteMediaResponse,
  FunnelEventBody,
  FunnelEventResponse,
  OutreachClaimResponse,
  ControlProspect,
  ControlProspectVetting,
  ControlProspectFact,
  ControlProspectEvidenceResponse,
  ControlCitedFact,
  ControlOutreachEmail,
  ControlOutreachEmailDetail,
  ControlOutreachSendingState,
  ControlDeliverabilityGuard,
  GrowthKpis,
  ControlGrowthResponse,
  ControlCopyVariant,
  ControlAdaptation,
  ControlDigest,
  ControlExperiment,
  ControlExperimentEvaluation,
  ControlCampaign,
  ControlPolicy,
};
