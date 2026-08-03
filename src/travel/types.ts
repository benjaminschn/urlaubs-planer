export const EVENT_TYPE_CODES = ["accommodation", "flight", "rail", "bus", "activity"] as const;

export type EventTypeCode = (typeof EVENT_TYPE_CODES)[number];
export type BookingStatus = "confirmed" | "cancelled" | "unknown";
export type TimePrecision = "exact_time" | "date_only" | "unknown_time";
export type TimeResolutionStatus = "resolved" | "date_only" | "unknown_time" | "ambiguous" | "nonexistent" | "unresolved";

export type LocalTimeValue = {
  localDate: string;
  localTime: string | null;
  precision: TimePrecision;
  ianaTimeZone: string | null;
  utcOffsetMinutes: number | null;
  instantUtc: string | null;
  resolutionStatus: TimeResolutionStatus;
};

export type Location = {
  id: string;
  name: string;
  fullAddress: string | null;
  street: string | null;
  houseNumber: string | null;
  postalCode: string | null;
  city: string | null;
  region: string | null;
  countryCode: string | null;
  locationCodeType: string | null;
  locationCode: string | null;
  latitude: number | null;
  longitude: number | null;
  ianaTimeZone: string | null;
};

export type LocationInput = Omit<Location, "id"> & { id?: string };

export type Reference = {
  kind: "booking" | "reservation" | "order" | "ticket" | "voucher" | "other";
  value: string;
};

export type ProviderContact = {
  role: string;
  phone: string;
  email: string;
  website: string;
};

export type PriceDetails = {
  total: string;
  currency: string;
  paid: string;
  outstanding: string;
  taxesAndFees: string;
  paymentStatus: string;
  paymentMethodMasked: string;
};

export type CommonTravelDetails = {
  references: Reference[];
  travelers: string[];
  providerContacts: ProviderContact[];
  price: PriceDetails;
  cancellationDeadline: LocalTimeValue | null;
  cancellationConditions: string;
  additionalAttributes: Array<{ label: string; value: string; unit: string }>;
};

export type TravelItemSegment = {
  id: string;
  sequenceNumber: number;
  startLocation: Location;
  endLocation: Location;
  departureTime: LocalTimeValue;
  arrivalTime: LocalTimeValue;
  details: Record<string, unknown>;
};

export type TravelItemSegmentInput = {
  id?: string;
  sequenceNumber: number;
  startLocation: LocationInput;
  endLocation: LocationInput;
  departureTime: LocalTimeValue;
  arrivalTime: LocalTimeValue;
  details: Record<string, unknown>;
};

export type TravelItemDetails = {
  common: CommonTravelDetails;
  type: Record<string, unknown>;
  segments: TravelItemSegment[];
};

export type TravelItemPayload = {
  eventTypeCode: EventTypeCode;
  title: string;
  bookingStatus: BookingStatus;
  startTime: LocalTimeValue;
  endTime: LocalTimeValue | null;
  locations: {
    main: LocationInput | null;
    start: LocationInput | null;
    end: LocationInput | null;
  };
  commonDetails: CommonTravelDetails & {
    providerName: string;
    bookingPlatformName: string;
    managementUrl: string;
    bookingDate: string;
    notes: string;
  };
  typeDetails: Record<string, unknown>;
  segments: TravelItemSegmentInput[];
};

export type TravelItem = {
  id: string;
  tripId: string;
  eventTypeCode: EventTypeCode;
  title: string;
  bookingStatus: BookingStatus;
  lifecycleStatus: "active" | "deleted";
  creationSource: "manual" | "candidate_confirmation";
  createdFromCandidateId: string | null;
  documentIds: string[];
  startTime: LocalTimeValue;
  endTime: LocalTimeValue | null;
  locations: {
    main: Location | null;
    start: Location | null;
    end: Location | null;
  };
  commonDetails: TravelItemPayload["commonDetails"];
  typeDetails: Record<string, unknown>;
  segments: TravelItemSegment[];
  stableSortKey: string;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type TravelItemLoadResult =
  | { kind: "ready"; items: TravelItem[] }
  | { kind: "unavailable" };

export type TravelItemMutationResult =
  | { kind: "created"; item: TravelItem }
  | { kind: "updated"; item: TravelItem }
  | { kind: "deleted"; itemId: string }
  | { kind: "conflict"; item?: TravelItem }
  | { kind: "limit"; message: string }
  | { kind: "validation"; message: string }
  | { kind: "forbidden"; message: string }
  | { kind: "unavailable"; message: string };

export type TravelItemGateway = {
  getTravelItems: (tripId: string) => Promise<TravelItemLoadResult>;
  createTravelItem: (input: { tripId: string; payload: TravelItemPayload; idempotencyKey: string }) => Promise<TravelItemMutationResult>;
  updateTravelItem: (input: {
    tripId: string;
    travelItemId: string;
    expectedVersion: number;
    payload: TravelItemPayload;
    idempotencyKey: string;
  }) => Promise<TravelItemMutationResult>;
  deleteTravelItem: (input: {
    tripId: string;
    travelItemId: string;
    expectedVersion: number;
    idempotencyKey: string;
  }) => Promise<TravelItemMutationResult>;
  subscribeToTravelItems: (options: {
    tripId: string;
    onSignal: () => void;
    onStatus: (status: TravelItemRealtimeStatus) => void;
  }) => () => void;
};

export type TravelItemRealtimeStatus = "connecting" | "connected" | "disconnected";
