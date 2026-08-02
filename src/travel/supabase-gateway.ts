import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  BookingStatus,
  EventTypeCode,
  LocalTimeValue,
  Location,
  LocationInput,
  ProviderContact,
  Reference,
  TravelItem,
  TravelItemGateway,
  TravelItemLoadResult,
  TravelItemMutationResult,
  TravelItemPayload,
  TravelItemRealtimeStatus,
  TravelItemSegment,
  TravelItemSegmentInput
} from "./types";

const travelItemColumns = [
  "id",
  "trip_id",
  "event_type_code",
  "title",
  "booking_status",
  "lifecycle_status",
  "creation_source",
  "start_time",
  "end_time",
  "main_location_id",
  "start_location_id",
  "end_location_id",
  "provider_name",
  "booking_platform_name",
  "management_url",
  "booking_date",
  "notes",
  "common_details",
  "stable_sort_key",
  "version",
  "created_at",
  "updated_at"
].join(",");

const locationColumns = [
  "id",
  "name",
  "full_address",
  "street",
  "house_number",
  "postal_code",
  "city",
  "region",
  "country_code",
  "location_code_type",
  "location_code",
  "latitude",
  "longitude",
  "iana_time_zone"
].join(",");

const detailsColumns = "travel_item_id,details";
const segmentColumns = "id,travel_item_id,sequence_number,start_location_id,end_location_id,departure_time,arrival_time,details";

type RecordLike = Record<string, unknown>;

function asRecord(value: unknown): RecordLike | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as RecordLike) : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function mapLocalTime(value: unknown): LocalTimeValue | null {
  const row = asRecord(value);
  if (!row || typeof row.local_date !== "string" || typeof row.precision !== "string") return null;
  if (!(["exact_time", "date_only", "unknown_time"] as string[]).includes(row.precision)) return null;
  return {
    localDate: row.local_date,
    localTime: asString(row.local_time),
    precision: row.precision as LocalTimeValue["precision"],
    ianaTimeZone: asString(row.iana_time_zone),
    utcOffsetMinutes: typeof row.utc_offset_minutes === "number" ? row.utc_offset_minutes : null,
    instantUtc: asString(row.instant_utc),
    resolutionStatus: (asString(row.resolution_status) ?? row.precision) as LocalTimeValue["resolutionStatus"]
  };
}

function mapLocation(value: unknown): Location | null {
  const row = asRecord(value);
  if (!row || typeof row.id !== "string" || typeof row.name !== "string") return null;
  return {
    id: row.id,
    name: row.name,
    fullAddress: asString(row.full_address),
    street: asString(row.street),
    houseNumber: asString(row.house_number),
    postalCode: asString(row.postal_code),
    city: asString(row.city),
    region: asString(row.region),
    countryCode: asString(row.country_code),
    locationCodeType: asString(row.location_code_type),
    locationCode: asString(row.location_code),
    latitude: typeof row.latitude === "number" ? row.latitude : null,
    longitude: typeof row.longitude === "number" ? row.longitude : null,
    ianaTimeZone: asString(row.iana_time_zone)
  };
}

function mapReference(value: unknown): Reference | null {
  const row = asRecord(value);
  if (!row || typeof row.value !== "string") return null;
  const allowed = ["booking", "reservation", "order", "ticket", "voucher", "other"];
  return {
    kind: allowed.includes(String(row.kind)) ? (row.kind as Reference["kind"]) : "other",
    value: row.value
  };
}

function mapProviderContact(value: unknown): ProviderContact | null {
  const row = asRecord(value);
  if (!row) return null;
  return {
    role: asString(row.role) ?? "",
    phone: asString(row.phone) ?? "",
    email: asString(row.email) ?? "",
    website: asString(row.website) ?? ""
  };
}

function mapCommonDetails(base: RecordLike): TravelItemPayload["commonDetails"] {
  const raw = asRecord(base.common_details) ?? {};
  const price = asRecord(raw.price) ?? {};
  const refs = Array.isArray(raw.references) ? raw.references.map(mapReference).filter((value): value is Reference => value !== null) : [];
  const contacts = Array.isArray(raw.provider_contacts)
    ? raw.provider_contacts.map(mapProviderContact).filter((value): value is ProviderContact => value !== null)
    : [];
  const travelers = Array.isArray(raw.travelers) ? raw.travelers.filter((value): value is string => typeof value === "string") : [];
  const attributes = Array.isArray(raw.additional_attributes)
    ? raw.additional_attributes
        .map((value) => {
          const row = asRecord(value);
          return row && typeof row.label === "string"
            ? { label: row.label, value: asString(row.value) ?? "", unit: asString(row.unit) ?? "" }
            : null;
        })
        .filter((value): value is { label: string; value: string; unit: string } => value !== null)
    : [];
  return {
    providerName: asString(base.provider_name) ?? "",
    bookingPlatformName: asString(base.booking_platform_name) ?? "",
    managementUrl: asString(base.management_url) ?? "",
    bookingDate: asString(base.booking_date) ?? "",
    notes: asString(base.notes) ?? "",
    references: refs,
    travelers,
    providerContacts: contacts,
    price: {
      total: asString(price.total) ?? "",
      currency: asString(price.currency) ?? "",
      paid: asString(price.paid) ?? "",
      outstanding: asString(price.outstanding) ?? "",
      taxesAndFees: asString(price.taxes_and_fees) ?? "",
      paymentStatus: asString(price.payment_status) ?? "",
      paymentMethodMasked: asString(price.payment_method_masked) ?? ""
    },
    cancellationDeadline: mapLocalTime(raw.cancellation_deadline),
    cancellationConditions: asString(raw.cancellation_conditions) ?? "",
    additionalAttributes: attributes
  };
}

function mapSegment(row: RecordLike, locations: Map<string, Location>): TravelItemSegment | null {
  if (
    typeof row.id !== "string" ||
    typeof row.sequence_number !== "number" ||
    typeof row.start_location_id !== "string" ||
    typeof row.end_location_id !== "string"
  ) {
    return null;
  }
  const startLocation = locations.get(row.start_location_id);
  const endLocation = locations.get(row.end_location_id);
  const departureTime = mapLocalTime(row.departure_time);
  const arrivalTime = mapLocalTime(row.arrival_time);
  if (!startLocation || !endLocation || !departureTime || !arrivalTime) return null;
  return {
    id: row.id,
    sequenceNumber: row.sequence_number,
    startLocation,
    endLocation,
    departureTime,
    arrivalTime,
    details: asRecord(row.details) ?? {}
  };
}

function mapItem(
  value: unknown,
  detailsByType: Map<string, RecordLike>,
  segmentsByType: Map<string, RecordLike[]>,
  locations: Map<string, Location>
): TravelItem | null {
  const row = asRecord(value);
  if (!row || typeof row.id !== "string" || typeof row.trip_id !== "string" || typeof row.event_type_code !== "string") return null;
  const startTime = mapLocalTime(row.start_time);
  if (!startTime || !["accommodation", "flight", "rail", "bus", "activity"].includes(row.event_type_code)) return null;
  const endTime = row.end_time === null || row.end_time === undefined ? null : mapLocalTime(row.end_time);
  if (row.end_time !== null && row.end_time !== undefined && !endTime) return null;
  const bookingStatus = row.booking_status;
  if (!(["confirmed", "cancelled", "unknown"] as unknown[]).includes(bookingStatus)) return null;
  const mainLocation = typeof row.main_location_id === "string" ? locations.get(row.main_location_id) ?? null : null;
  const startLocation = typeof row.start_location_id === "string" ? locations.get(row.start_location_id) ?? null : null;
  const endLocation = typeof row.end_location_id === "string" ? locations.get(row.end_location_id) ?? null : null;
  const typeDetails = detailsByType.get(row.event_type_code);
  const segments = (segmentsByType.get(row.event_type_code) ?? [])
    .map((segment) => mapSegment(segment, locations))
    .filter((segment): segment is TravelItemSegment => segment !== null)
    .sort((left, right) => left.sequenceNumber - right.sequenceNumber);
  if (
    typeof row.title !== "string" ||
    typeof row.stable_sort_key !== "string" ||
    typeof row.version !== "number" ||
    typeof row.created_at !== "string" ||
    typeof row.updated_at !== "string"
  ) {
    return null;
  }
  return {
    id: row.id,
    tripId: row.trip_id,
    eventTypeCode: row.event_type_code as EventTypeCode,
    title: row.title,
    bookingStatus: bookingStatus as BookingStatus,
    lifecycleStatus: row.lifecycle_status === "deleted" ? "deleted" : "active",
    creationSource: row.creation_source === "candidate_confirmation" ? "candidate_confirmation" : "manual",
    startTime,
    endTime,
    locations: { main: mainLocation, start: startLocation, end: endLocation },
    commonDetails: mapCommonDetails(row),
    typeDetails: typeDetails?.details && typeof typeDetails.details === "object" ? (typeDetails.details as RecordLike) : {},
    segments,
    stableSortKey: row.stable_sort_key,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toApiLocation(value: LocationInput | null): RecordLike | null {
  if (!value) return null;
  return {
    id: value.id,
    name: value.name,
    full_address: value.fullAddress || null,
    street: value.street || null,
    house_number: value.houseNumber || null,
    postal_code: value.postalCode || null,
    city: value.city || null,
    region: value.region || null,
    country_code: value.countryCode || null,
    location_code_type: value.locationCodeType || null,
    location_code: value.locationCode || null,
    latitude: value.latitude,
    longitude: value.longitude,
    iana_time_zone: value.ianaTimeZone || null
  };
}

function toApiLocalTime(value: LocalTimeValue): RecordLike {
  return {
    local_date: value.localDate,
    local_time: value.localTime,
    precision: value.precision,
    iana_time_zone: value.ianaTimeZone,
    utc_offset_minutes: value.utcOffsetMinutes,
    instant_utc: value.instantUtc,
    resolution_status: value.resolutionStatus
  };
}

function toApiSegment(value: TravelItemSegmentInput): RecordLike {
  return {
    id: value.id,
    sequence_number: value.sequenceNumber,
    start_location: toApiLocation(value.startLocation),
    end_location: toApiLocation(value.endLocation),
    departure_time: toApiLocalTime(value.departureTime),
    arrival_time: toApiLocalTime(value.arrivalTime),
    details: value.details
  };
}

function toApiPayload(payload: TravelItemPayload): RecordLike {
  const common = payload.commonDetails;
  return {
    event_type_code: payload.eventTypeCode,
    title: payload.title,
    booking_status: payload.bookingStatus,
    start_time: toApiLocalTime(payload.startTime),
    end_time: payload.endTime ? toApiLocalTime(payload.endTime) : null,
    locations: {
      main: toApiLocation(payload.locations.main),
      start: toApiLocation(payload.locations.start),
      end: toApiLocation(payload.locations.end)
    },
    common_details: {
      provider_name: common.providerName,
      booking_platform_name: common.bookingPlatformName,
      management_url: common.managementUrl,
      booking_date: common.bookingDate || null,
      notes: common.notes,
      references: common.references,
      travelers: common.travelers,
      provider_contacts: common.providerContacts,
      price: {
        total: common.price.total,
        currency: common.price.currency,
        paid: common.price.paid,
        outstanding: common.price.outstanding,
        taxes_and_fees: common.price.taxesAndFees,
        payment_status: common.price.paymentStatus,
        payment_method_masked: common.price.paymentMethodMasked
      },
      cancellation_deadline: common.cancellationDeadline ? toApiLocalTime(common.cancellationDeadline) : null,
      cancellation_conditions: common.cancellationConditions,
      additional_attributes: common.additionalAttributes
    },
    type_details: payload.typeDetails,
    segments: payload.segments.map(toApiSegment)
  };
}

function firstRow(data: unknown): RecordLike | null {
  if (Array.isArray(data)) return asRecord(data[0]);
  return asRecord(data);
}

function mapMutation(
  data: unknown,
  error: { code?: string; message?: string } | null
): { status: string; id: string | null; message: string | null } {
  const row = firstRow(data);
  if (row && typeof row.operation_status === "string") {
    return {
      status: row.operation_status,
      id: typeof row.travel_item_id === "string" ? row.travel_item_id : null,
      message: typeof row.error_message === "string" ? row.error_message : null
    };
  }
  if (error?.code === "P0001") return { status: "validation", id: null, message: null };
  if (error?.code === "42501") return { status: "forbidden", id: null, message: null };
  return { status: "unavailable", id: null, message: null };
}

function stableMessage(status: string, message: string | null): string {
  if (status === "validation") return message ?? "Bitte prüfen Sie die Ereignisdaten.";
  if (status === "limit") return message ?? "Die Reiseereignis-Grenze wurde erreicht.";
  if (status === "conflict") return "Das Ereignis wurde zwischenzeitlich geändert. Der neue Stand wurde geladen.";
  if (status === "forbidden") return "Das Ereignis ist nicht verfügbar.";
  return message ?? "Das Ereignis konnte nicht gespeichert werden. Ihre Eingaben bleiben erhalten.";
}

export function createSupabaseTravelItemGateway(client: SupabaseClient): TravelItemGateway {
  async function getTravelItems(tripId: string): Promise<TravelItemLoadResult> {
    const baseResult = await client
      .from("travel_items")
      .select(travelItemColumns)
      .eq("trip_id", tripId)
      .eq("lifecycle_status", "active")
      .order("start_local_date", { ascending: true });
    if (baseResult.error) return { kind: "unavailable" };
    const baseRows = Array.isArray(baseResult.data) ? baseResult.data : [];
    const ids = baseRows.map((row) => asRecord(row)?.id).filter((value): value is string => typeof value === "string");
    if (ids.length === 0) return { kind: "ready", items: [] };

    const tables = [
      ["accommodation_details", detailsColumns],
      ["flight_details", detailsColumns],
      ["rail_details", detailsColumns],
      ["bus_details", detailsColumns],
      ["activity_details", detailsColumns],
      ["flight_segments", segmentColumns],
      ["rail_segments", segmentColumns],
      ["bus_segments", segmentColumns]
    ] as const;
    const relatedResults = await Promise.all(
      tables.map(([table, columns]) => client.from(table).select(columns).in("travel_item_id", ids))
    );
    if (relatedResults.some((result) => result.error)) return { kind: "unavailable" };
    const locationIds = new Set<string>();
    for (const row of baseRows) {
      const value = asRecord(row);
      for (const key of ["main_location_id", "start_location_id", "end_location_id"]) {
        if (typeof value?.[key] === "string") locationIds.add(value[key] as string);
      }
    }
    for (const result of relatedResults.slice(5)) {
      for (const row of Array.isArray(result.data) ? result.data : []) {
        const value = asRecord(row);
        for (const key of ["start_location_id", "end_location_id"]) {
          if (typeof value?.[key] === "string") locationIds.add(value[key] as string);
        }
      }
    }
    const locationResult = locationIds.size
      ? await client.from("locations").select(locationColumns).in("id", [...locationIds])
      : { data: [], error: null };
    if (locationResult.error) return { kind: "unavailable" };
    const locations = new Map<string, Location>();
    for (const row of Array.isArray(locationResult.data) ? locationResult.data : []) {
      const location = mapLocation(row);
      if (location) locations.set(location.id, location);
    }
    const detailsByType = new Map<string, RecordLike>();
    for (let index = 0; index < 5; index += 1) {
      const relatedData: unknown = relatedResults[index].data;
      const tableRows: unknown[] = Array.isArray(relatedData) ? relatedData : [];
      for (const row of tableRows) {
        const value = asRecord(row);
        if (value?.travel_item_id) detailsByType.set(`${tables[index][0]}:${value.travel_item_id}`, value);
      }
    }
    const segmentsByType = new Map<string, RecordLike[]>();
    for (const [index, type] of [[5, "flight"], [6, "rail"], [7, "bus"]] as const) {
      for (const row of Array.isArray(relatedResults[index].data) ? relatedResults[index].data : []) {
        const value = asRecord(row);
        if (!value || typeof value.travel_item_id !== "string") continue;
        const current = segmentsByType.get(`${type}:${value.travel_item_id}`) ?? [];
        current.push(value);
        segmentsByType.set(`${type}:${value.travel_item_id}`, current);
      }
    }
    const items = baseRows
      .map((row) => {
        const base = asRecord(row);
        if (!base || typeof base.id !== "string" || typeof base.event_type_code !== "string") return null;
        const detailTable = `${base.event_type_code}_details`;
        const detail = detailsByType.get(`${detailTable}:${base.id}`);
        const segmentRows = segmentsByType.get(`${base.event_type_code}:${base.id}`) ?? [];
        return mapItem(
          row,
          new Map(detail ? [[base.event_type_code, detail]] : []),
          new Map(segmentRows.length ? [[base.event_type_code, segmentRows]] : []),
          locations
        );
      })
      .filter((item): item is TravelItem => item !== null);
    return { kind: "ready", items };
  }

  async function refreshItem(tripId: string, itemId: string): Promise<TravelItem | null> {
    const result = await getTravelItems(tripId);
    return result.kind === "ready" ? result.items.find((item) => item.id === itemId) ?? null : null;
  }

  async function mutate(
    rpcName: "create_travel_item" | "update_travel_item" | "delete_travel_item",
    params: Record<string, unknown>,
    tripId: string,
    itemId: string | null,
    successKind: "created" | "updated" | "deleted"
  ): Promise<TravelItemMutationResult> {
    const { data, error } = await client.rpc(rpcName, params);
    const mapped = mapMutation(data, error);
    if (mapped.status === "conflict") {
      const item = itemId ? await refreshItem(tripId, itemId) : undefined;
      return { kind: "conflict", item: item ?? undefined };
    }
    if (mapped.status === "limit") return { kind: "limit", message: stableMessage(mapped.status, mapped.message) };
    if (mapped.status === "validation") return { kind: "validation", message: stableMessage(mapped.status, mapped.message) };
    if (mapped.status === "forbidden") return { kind: "forbidden", message: stableMessage(mapped.status, mapped.message) };
    if (!([successKind, "replayed"] as string[]).includes(mapped.status)) {
      return { kind: "unavailable", message: stableMessage(mapped.status, mapped.message) };
    }
    const resolvedId = mapped.id ?? itemId;
    if (successKind === "deleted") return { kind: "deleted", itemId: resolvedId ?? "" };
    const item = resolvedId ? await refreshItem(tripId, resolvedId) : null;
    return item ? { kind: successKind, item } : { kind: "unavailable", message: "Der bestätigte Stand konnte nicht geladen werden." };
  }

  return {
    getTravelItems,
    createTravelItem(input) {
      return mutate(
        "create_travel_item",
        { p_trip_id: input.tripId, p_payload: toApiPayload(input.payload), p_idempotency_key: input.idempotencyKey },
        input.tripId,
        null,
        "created"
      );
    },
    updateTravelItem(input) {
      return mutate(
        "update_travel_item",
        {
          p_travel_item_id: input.travelItemId,
          p_expected_version: input.expectedVersion,
          p_payload: toApiPayload(input.payload),
          p_idempotency_key: input.idempotencyKey
        },
        input.tripId,
        input.travelItemId,
        "updated"
      );
    },
    deleteTravelItem(input) {
      return mutate(
        "delete_travel_item",
        {
          p_travel_item_id: input.travelItemId,
          p_expected_version: input.expectedVersion,
          p_idempotency_key: input.idempotencyKey
        },
        input.tripId,
        input.travelItemId,
        "deleted"
      );
    },
    subscribeToTravelItems({ tripId, onSignal, onStatus }) {
      let disposed = false;
      let reconnectTimer: number | null = null;
      let channel: ReturnType<SupabaseClient["channel"]> | null = null;

      const scheduleReconnect = () => {
        if (disposed || reconnectTimer !== null) return;
        reconnectTimer = window.setTimeout(() => {
          reconnectTimer = null;
          subscribe();
        }, 1000);
      };
      const subscribe = () => {
        if (disposed) return;
        onStatus("connecting");
        channel = client
          .channel(`travel-items:${tripId}`)
          .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "travel_items", filter: `trip_id=eq.${tripId}` },
            () => onSignal()
          )
          .subscribe((status: string) => {
            const mapped: TravelItemRealtimeStatus =
              status === "SUBSCRIBED"
                ? "connected"
                : status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED"
                  ? "disconnected"
                  : "connecting";
            onStatus(mapped);
            if (mapped === "disconnected") scheduleReconnect();
          });
      };
      subscribe();
      return () => {
        disposed = true;
        if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
        if (channel) void client.removeChannel(channel);
      };
    }
  };
}
