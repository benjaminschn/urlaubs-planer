import type { BookingStatus, EventTypeCode, LocalTimeValue, LocationInput, TravelItemPayload, TravelItemSegmentInput } from "../travel/types";
import type { CandidateCorrectionInput, ExtractionCandidate, ExtractionField } from "./types";

type JsonObject = Record<string, unknown>;

function effectiveValue(fields: ExtractionField[], path: string): unknown {
  return fields.find((field) => field.fieldPath === path && field.occurrenceKey === "")?.value ?? null;
}

function stringValue(fields: ExtractionField[], path: string): string {
  const value = effectiveValue(fields, path);
  return typeof value === "string" ? value : "";
}

function offsetMinutes(value: string): number | null {
  const match = value.match(/^([+-])(\d{2}):(\d{2})$/);
  if (!match) return null;
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === "-" ? -minutes : minutes;
}

function localTime(fields: ExtractionField[], prefix: string): JsonObject | null {
  const localDate = stringValue(fields, `${prefix}.local_date`);
  if (!localDate) return null;
  const extractedPrecision = stringValue(fields, `${prefix}.precision`);
  const localTimeValue = stringValue(fields, `${prefix}.local_time`) || null;
  const zone = stringValue(fields, `${prefix}.iana_time_zone`) || null;
  const offset = offsetMinutes(stringValue(fields, `${prefix}.utc_offset`));
  const instant = stringValue(fields, `${prefix}.instant_utc`) || null;
  const extractedResolution = stringValue(fields, `${prefix}.resolution_status`);

  // Prefer keeping a printed local clock time. Full zone chain is optional until resolved.
  if (localTimeValue && /^\d{2}:\d{2}(?::\d{2})?$/.test(localTimeValue)) {
    const fullyResolved = Boolean(zone && offset !== null && instant && extractedResolution === "resolved");
    return {
      local_date: localDate,
      local_time: localTimeValue,
      precision: "exact_time",
      iana_time_zone: zone,
      utc_offset_minutes: offset,
      instant_utc: instant,
      resolution_status: fullyResolved ? "resolved" : (["unresolved", "ambiguous", "nonexistent"].includes(extractedResolution) ? extractedResolution : "unresolved")
    };
  }

  const precision = extractedPrecision === "unknown_time" ? "unknown_time" : "date_only";
  return {
    local_date: localDate,
    local_time: null,
    precision,
    iana_time_zone: null,
    utc_offset_minutes: null,
    instant_utc: null,
    resolution_status: precision
  };
}

function fieldValue(candidate: ExtractionCandidate, path: string, occurrenceKey = ""): unknown {
  return candidate.fields.find((field) => field.fieldPath === path && field.occurrenceKey === occurrenceKey)?.value ?? null;
}

function compactStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())) : [];
}

function extractedLocation(candidate: ExtractionCandidate, prefix: string, occurrenceKey = ""): JsonObject | null {
  const keys = ["name", "full_address", "street", "house_number", "postal_code", "city", "region", "country_code", "location_code_type", "location_code", "latitude", "longitude", "iana_time_zone"];
  const value = Object.fromEntries(keys.map((key) => [key, fieldValue(candidate, `${prefix}.${key}`, occurrenceKey)]));
  return Object.values(value).some((item) => item !== null && item !== "") ? value : null;
}

function extractedTime(candidate: ExtractionCandidate, prefix: string, occurrenceKey = ""): JsonObject {
  const localDate = fieldValue(candidate, `${prefix}.local_date`, occurrenceKey);
  const localTimeValue = fieldValue(candidate, `${prefix}.local_time`, occurrenceKey);
  const precision = fieldValue(candidate, `${prefix}.precision`, occurrenceKey);
  const zone = fieldValue(candidate, `${prefix}.iana_time_zone`, occurrenceKey);
  const offset = fieldValue(candidate, `${prefix}.utc_offset`, occurrenceKey);
  const instant = fieldValue(candidate, `${prefix}.instant_utc`, occurrenceKey);
  const resolution = fieldValue(candidate, `${prefix}.resolution_status`, occurrenceKey);
  return {
    local_date: typeof localDate === "string" ? localDate : "",
    local_time: typeof localTimeValue === "string" ? localTimeValue : null,
    precision: ["exact_time", "date_only", "unknown_time"].includes(String(precision)) ? precision : "date_only",
    iana_time_zone: typeof zone === "string" ? zone : null,
    utc_offset_minutes: typeof offset === "number" ? offset : typeof offset === "string" ? offsetMinutes(offset) : null,
    instant_utc: typeof instant === "string" ? instant : null,
    resolution_status: typeof resolution === "string" ? resolution : precision === "exact_time" ? "unresolved" : precision || "date_only"
  };
}

const extractedTypeKeyMap: Record<string, string> = {
  night_count: "nights", room_count: "rooms", guest_count: "guests", room_description: "room_name",
  check_in_instructions: "access_instructions", change_conditions: "rebooking_conditions",
  train_number: "train_number", train_type: "train_type", line_name: "line_name", travel_class: "class",
  category: "category", description: "practical_notes", ticket_numbers: "ticket_number"
};

function typeDetails(candidate: ExtractionCandidate): JsonObject {
  const sourceType = candidate.proposedEventTypeCode === "rail" ? "train" : candidate.proposedEventTypeCode === "bus" || candidate.proposedEventTypeCode === "activity" ? "generic" : candidate.proposedEventTypeCode;
  const prefix = `details.${sourceType}.`;
  return Object.fromEntries(candidate.fields.flatMap((field) => {
    if (field.occurrenceKey || !field.fieldPath.startsWith(prefix) || field.fieldPath.includes(".segments.")) return [];
    if (field.value === null || typeof field.value === "object") return [];
    let sourceKey = field.fieldPath.slice(prefix.length);
    const nestedKeyMap: Record<string, string> = {
      "check_in.local_date": "check_in_date",
      "check_in.local_time": "check_in_time_window",
      "check_out.local_date": "check_out_date",
      "check_out.local_time": "check_out_time_window",
      "meeting_point.name": "meeting_point",
      "end_point.name": "end_point"
    };
    if (sourceKey.includes(".")) {
      const mapped = nestedKeyMap[sourceKey];
      if (!mapped) return [];
      sourceKey = mapped;
    }
    const contextualKeyMap: Partial<Record<ExtractionCandidate["proposedEventTypeCode"], Record<string, string>>> = {
      accommodation: { included_services: "meal_plan" },
      flight: { fare_conditions: "ticket_conditions", change_conditions: "rebooking_conditions" },
      rail: { fare_conditions: "ticket_conditions", change_conditions: "rebooking_conditions" },
      bus: { ticket_numbers: "ticket_numbers", included_services: "booked_services" },
      activity: { ticket_numbers: "ticket_number", included_services: "included_services", excluded_services: "excluded_services", requirements: "requirements" }
    };
    const key = contextualKeyMap[candidate.proposedEventTypeCode]?.[sourceKey] ?? extractedTypeKeyMap[sourceKey] ?? sourceKey;
    const allowedExtractedKeys: Record<ExtractionCandidate["proposedEventTypeCode"], Set<string>> = {
      accommodation: new Set(["accommodation_name", "accommodation_type", "check_in_date", "check_in_time_window", "check_out_date", "check_out_time_window", "nights", "rooms", "guests", "room_name", "meal_plan", "access_instructions", "access_code", "special_requests"]),
      flight: new Set(["ticket_conditions", "rebooking_conditions", "cancellation_conditions"]),
      rail: new Set(["ticket_conditions", "rebooking_conditions", "cancellation_conditions"]),
      bus: new Set(["ticket_numbers", "booked_services"]),
      activity: new Set(["category", "practical_notes", "meeting_point", "end_point", "ticket_number", "participant_count", "requirements", "included_services", "excluded_services"])
    };
    if (!allowedExtractedKeys[candidate.proposedEventTypeCode].has(key)) return [];
    const value = Array.isArray(field.value) ? compactStrings(field.value).join("\n") : String(field.value);
    return key ? [[key, value]] : [];
  }));
}

function extractedSegments(candidate: ExtractionCandidate): JsonObject[] {
  const sourceType = candidate.proposedEventTypeCode === "rail" ? "train" : candidate.proposedEventTypeCode;
  if (sourceType !== "flight" && sourceType !== "train") return [];
  const prefix = `details.${sourceType}.segments.`;
  const occurrenceKeys = [...new Set(candidate.fields.filter((field) => field.fieldPath.startsWith(prefix) && field.occurrenceKey).map((field) => field.occurrenceKey))]
    .sort((left, right) => Number(fieldValue(candidate, `${prefix}sequence`, left) ?? left.split(":").at(-1)) - Number(fieldValue(candidate, `${prefix}sequence`, right) ?? right.split(":").at(-1)));
  return occurrenceKeys.map((occurrenceKey, index) => {
    const value = (key: string) => fieldValue(candidate, `${prefix}${key}`, occurrenceKey);
    const details = sourceType === "flight"
      ? {
          operator: value("operating_carrier") ?? value("marketing_carrier"), number: value("flight_number"),
          departure_terminal_or_platform: [value("departure_terminal"), value("departure_gate")].filter(Boolean).join(" / "),
          arrival_terminal_or_platform: [value("arrival_terminal"), value("arrival_gate")].filter(Boolean).join(" / "),
          passenger_names: compactStrings(value("passengers")).join("\n"), seat: compactStrings(value("seats")).join("\n"),
          cabin_or_booking_class: value("cabin_class") ?? value("booking_class"), ticket_or_booking_numbers: compactStrings(value("ticket_numbers")).join("\n"),
          baggage_and_services: [value("checked_baggage"), value("cabin_baggage"), ...compactStrings(value("services"))].filter(Boolean).join("\n"),
          duration: value("duration_minutes"), transfer_duration: value("layover_after_minutes")
        }
      : {
          operator: value("operator"), number: value("train_number") ?? value("line_name"),
          departure_terminal_or_platform: value("departure_platform"), arrival_terminal_or_platform: value("arrival_platform"),
          passenger_names: compactStrings(value("travelers")).join("\n"), seat: compactStrings(value("seats")).join("\n"),
          cabin_or_booking_class: value("travel_class"), reservation_status: value("reservation_status"),
          ticket_or_booking_numbers: [...compactStrings(value("ticket_numbers")), ...compactStrings(value("order_numbers")), ...compactStrings(value("reservation_numbers"))].join("\n"),
          duration: value("duration_minutes"), transfer_duration: value("layover_after_minutes")
        };
    return {
      sequence_number: index + 1,
      start_location: extractedLocation(candidate, `${prefix}departure_location`, occurrenceKey) ?? {},
      end_location: extractedLocation(candidate, `${prefix}arrival_location`, occurrenceKey) ?? {},
      departure_time: extractedTime(candidate, `${prefix}departure`, occurrenceKey),
      arrival_time: extractedTime(candidate, `${prefix}arrival`, occurrenceKey),
      details: Object.fromEntries(Object.entries(details).filter(([, item]) => item !== null && item !== "").map(([key, item]) => [key, String(item)]))
    };
  });
}

export function candidateToCanonicalPayload(candidate: ExtractionCandidate): JsonObject {
  if (candidate.canonicalPayload) return structuredClone(candidate.canonicalPayload);
  const start = localTime(candidate.fields, "start");
  const end = localTime(candidate.fields, "end");
  const rawReferences = fieldValue(candidate, "booking_references");
  const rawContacts = fieldValue(candidate, "provider_contacts");
  const rawAttributes = fieldValue(candidate, "additional_attributes");
  const references = Array.isArray(rawReferences) ? rawReferences.map(objectValue).map((item) => ({ kind: referenceKind(item.kind), value: text(item.value) })).filter((item) => item.value) : [];
  const contacts = Array.isArray(rawContacts) ? rawContacts.map(objectValue).map((item) => ({ role: text(item.role), phone: text(item.phone), email: text(item.email), website: text(item.website) })) : [];
  const attributes = Array.isArray(rawAttributes) ? rawAttributes.map(objectValue).map((item) => ({ label: text(item.label), value: text(item.value), unit: text(item.unit) })).filter((item) => item.label && item.value) : [];
  return {
    event_type_code: candidate.proposedEventTypeCode,
    title: stringValue(candidate.fields, "title"),
    booking_status: stringValue(candidate.fields, "booking_status") || "unknown",
    start_time: start,
    end_time: end,
    locations: {
      main: extractedLocation(candidate, "main_location"),
      start: extractedLocation(candidate, "start_location"),
      end: extractedLocation(candidate, "end_location")
    },
    common_details: {
      provider_name: stringValue(candidate.fields, "provider_name"),
      booking_platform_name: stringValue(candidate.fields, "booking_platform_name"),
      management_url: stringValue(candidate.fields, "management_url"),
      booking_date: stringValue(candidate.fields, "booking_date") || null,
      notes: stringValue(candidate.fields, "notes"),
      references,
      travelers: compactStrings(fieldValue(candidate, "travelers")),
      provider_contacts: contacts,
      price: {
        total: text(fieldValue(candidate, "pricing.total_amount")), currency: text(fieldValue(candidate, "pricing.currency")),
        paid: text(fieldValue(candidate, "pricing.paid_amount")), outstanding: text(fieldValue(candidate, "pricing.outstanding_amount")),
        taxes_and_fees: text(fieldValue(candidate, "pricing.taxes_and_fees_amount")), payment_status: text(fieldValue(candidate, "pricing.payment_status")),
        payment_method_masked: text(fieldValue(candidate, "pricing.payment_method_masked"))
      },
      cancellation_deadline: localTime(candidate.fields, "cancellation_deadline"),
      cancellation_conditions: stringValue(candidate.fields, "cancellation_conditions"),
      additional_attributes: attributes
    },
    type_details: typeDetails(candidate),
    segments: extractedSegments(candidate)
  };
}

export function validateCanonicalPayload(payload: JsonObject): string[] {
  const errors: string[] = [];
  if (!["accommodation", "flight", "rail", "bus", "activity"].includes(String(payload.event_type_code))) errors.push("Bitte wählen Sie eine unterstützte Ereignisart.");
  if (typeof payload.title !== "string" || !payload.title.trim()) errors.push("Bitte geben Sie einen Titel ein.");
  const start = payload.start_time && typeof payload.start_time === "object" && !Array.isArray(payload.start_time) ? payload.start_time as JsonObject : null;
  if (!start || typeof start.local_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(start.local_date)) errors.push("Bitte geben Sie ein gültiges Startdatum ein.");
  if (!Array.isArray(payload.segments)) errors.push("Teilstrecken müssen als Liste gespeichert werden.");
  return errors;
}

function objectValue(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function nullableText(value: unknown): string | null {
  const result = text(value);
  return result || null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function referenceKind(value: unknown): TravelItemPayload["commonDetails"]["references"][number]["kind"] {
  const kind = text(value);
  return ["booking", "reservation", "order", "ticket", "voucher", "other"].includes(kind)
    ? kind as TravelItemPayload["commonDetails"]["references"][number]["kind"]
    : "other";
}

function canonicalTime(value: unknown, fallbackDate = ""): LocalTimeValue {
  const raw = objectValue(value);
  const precision = ["exact_time", "date_only", "unknown_time"].includes(text(raw.precision))
    ? text(raw.precision) as LocalTimeValue["precision"]
    : "date_only";
  const resolution = ["resolved", "date_only", "unknown_time", "ambiguous", "nonexistent", "unresolved"].includes(text(raw.resolution_status))
    ? text(raw.resolution_status) as LocalTimeValue["resolutionStatus"]
    : precision === "exact_time" ? "unresolved" : precision;
  return {
    localDate: text(raw.local_date) || fallbackDate,
    localTime: nullableText(raw.local_time),
    precision,
    ianaTimeZone: nullableText(raw.iana_time_zone),
    utcOffsetMinutes: numberOrNull(raw.utc_offset_minutes),
    instantUtc: nullableText(raw.instant_utc),
    resolutionStatus: resolution
  };
}

function canonicalLocation(value: unknown): LocationInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as JsonObject;
  return {
    ...(typeof raw.id === "string" ? { id: raw.id } : {}),
    name: text(raw.name),
    fullAddress: nullableText(raw.full_address),
    street: nullableText(raw.street),
    houseNumber: nullableText(raw.house_number),
    postalCode: nullableText(raw.postal_code),
    city: nullableText(raw.city),
    region: nullableText(raw.region),
    countryCode: nullableText(raw.country_code),
    locationCodeType: nullableText(raw.location_code_type),
    locationCode: nullableText(raw.location_code),
    latitude: numberOrNull(raw.latitude),
    longitude: numberOrNull(raw.longitude),
    ianaTimeZone: nullableText(raw.iana_time_zone)
  };
}

function toCanonicalTime(value: LocalTimeValue): JsonObject {
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

function toCanonicalLocation(value: LocationInput | null): JsonObject | null {
  if (!value) return null;
  return {
    ...(value.id ? { id: value.id } : {}),
    name: value.name,
    full_address: value.fullAddress,
    street: value.street,
    house_number: value.houseNumber,
    postal_code: value.postalCode,
    city: value.city,
    region: value.region,
    country_code: value.countryCode,
    location_code_type: value.locationCodeType,
    location_code: value.locationCode,
    latitude: value.latitude,
    longitude: value.longitude,
    iana_time_zone: value.ianaTimeZone
  };
}

export function canonicalPayloadToTravelItemPayload(payload: JsonObject): TravelItemPayload {
  const locations = objectValue(payload.locations);
  const common = objectValue(payload.common_details);
  const price = objectValue(common.price);
  const eventTypeCode = ["accommodation", "flight", "rail", "bus", "activity"].includes(text(payload.event_type_code))
    ? text(payload.event_type_code) as EventTypeCode
    : "activity";
  const bookingStatus = ["confirmed", "cancelled", "unknown"].includes(text(payload.booking_status))
    ? text(payload.booking_status) as BookingStatus
    : "unknown";
  const startTime = canonicalTime(payload.start_time);
  const rawSegments = Array.isArray(payload.segments) ? payload.segments : [];
  return {
    eventTypeCode,
    title: text(payload.title),
    bookingStatus,
    startTime,
    endTime: payload.end_time ? canonicalTime(payload.end_time) : null,
    locations: {
      main: canonicalLocation(locations.main),
      start: canonicalLocation(locations.start),
      end: canonicalLocation(locations.end)
    },
    commonDetails: {
      providerName: text(common.provider_name),
      bookingPlatformName: text(common.booking_platform_name),
      managementUrl: text(common.management_url),
      bookingDate: text(common.booking_date),
      notes: text(common.notes),
      references: Array.isArray(common.references) ? common.references.map((value) => objectValue(value)).map((value) => ({ kind: referenceKind(value.kind), value: text(value.value) })).filter((value) => value.value) : [],
      travelers: Array.isArray(common.travelers) ? common.travelers.map(text).filter(Boolean) : [],
      providerContacts: Array.isArray(common.provider_contacts) ? common.provider_contacts.map((value) => objectValue(value)).map((value) => ({ role: text(value.role), phone: text(value.phone), email: text(value.email), website: text(value.website) })) : [],
      price: {
        total: text(price.total), currency: text(price.currency), paid: text(price.paid), outstanding: text(price.outstanding),
        taxesAndFees: text(price.taxes_and_fees), paymentStatus: text(price.payment_status), paymentMethodMasked: text(price.payment_method_masked)
      },
      cancellationDeadline: common.cancellation_deadline ? canonicalTime(common.cancellation_deadline) : null,
      cancellationConditions: text(common.cancellation_conditions),
      additionalAttributes: Array.isArray(common.additional_attributes) ? common.additional_attributes.map((value) => objectValue(value)).map((value) => ({ label: text(value.label), value: text(value.value), unit: text(value.unit) })).filter((value) => value.label && value.value) : []
    },
    typeDetails: objectValue(payload.type_details),
    segments: rawSegments.map((value, index): TravelItemSegmentInput => {
      const segment = objectValue(value);
      return {
        ...(typeof segment.id === "string" ? { id: segment.id } : {}),
        sequenceNumber: typeof segment.sequence_number === "number" ? segment.sequence_number : index + 1,
        startLocation: canonicalLocation(segment.start_location) ?? canonicalLocation({})!,
        endLocation: canonicalLocation(segment.end_location) ?? canonicalLocation({})!,
        departureTime: canonicalTime(segment.departure_time, startTime.localDate),
        arrivalTime: canonicalTime(segment.arrival_time, startTime.localDate),
        details: objectValue(segment.details)
      };
    })
  };
}

export function travelItemPayloadToCanonicalPayload(payload: TravelItemPayload): JsonObject {
  const common = payload.commonDetails;
  return {
    event_type_code: payload.eventTypeCode,
    title: payload.title.trim(),
    booking_status: payload.bookingStatus,
    start_time: toCanonicalTime(payload.startTime),
    end_time: payload.endTime ? toCanonicalTime(payload.endTime) : null,
    locations: { main: toCanonicalLocation(payload.locations.main), start: toCanonicalLocation(payload.locations.start), end: toCanonicalLocation(payload.locations.end) },
    common_details: {
      provider_name: common.providerName,
      booking_platform_name: common.bookingPlatformName,
      management_url: common.managementUrl,
      booking_date: common.bookingDate || null,
      notes: common.notes,
      references: common.references,
      travelers: common.travelers,
      provider_contacts: common.providerContacts,
      price: { total: common.price.total, currency: common.price.currency, paid: common.price.paid, outstanding: common.price.outstanding, taxes_and_fees: common.price.taxesAndFees, payment_status: common.price.paymentStatus, payment_method_masked: common.price.paymentMethodMasked },
      cancellation_deadline: common.cancellationDeadline ? toCanonicalTime(common.cancellationDeadline) : null,
      cancellation_conditions: common.cancellationConditions,
      additional_attributes: common.additionalAttributes
    },
    type_details: payload.typeDetails,
    segments: payload.segments.map((segment) => ({
      ...(segment.id ? { id: segment.id } : {}),
      sequence_number: segment.sequenceNumber,
      start_location: toCanonicalLocation(segment.startLocation),
      end_location: toCanonicalLocation(segment.endLocation),
      departure_time: toCanonicalTime(segment.departureTime),
      arrival_time: toCanonicalTime(segment.arrivalTime),
      details: segment.details
    }))
  };
}

export function candidateCorrections(previous: JsonObject, next: JsonObject): CandidateCorrectionInput[] {
  const corrections: CandidateCorrectionInput[] = [];
  const visit = (before: unknown, after: unknown, path: string) => {
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    const beforeObject = before && typeof before === "object" && !Array.isArray(before) ? before as JsonObject : null;
    const afterObject = after && typeof after === "object" && !Array.isArray(after) ? after as JsonObject : null;
    if (beforeObject && afterObject) {
      for (const key of new Set([...Object.keys(beforeObject), ...Object.keys(afterObject)])) {
        visit(beforeObject[key], afterObject[key], path ? `${path}.${key}` : key);
      }
      return;
    }
    corrections.push({
      fieldPath: path,
      occurrenceKey: "",
      operation: after === undefined || after === null ? "remove" : Array.isArray(after) && Array.isArray(before) ? "reorder" : "set",
      // The current RPC requires a non-null jsonb argument even for remove operations.
      newValue: after === undefined || after === null ? { removed: true } : after
    });
  };
  visit(previous, next, "");
  return corrections.filter((correction) => correction.fieldPath && correction.fieldPath !== "$canonical_payload");
}
