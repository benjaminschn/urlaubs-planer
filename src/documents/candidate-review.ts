import type { ExtractionCandidate, ExtractionField } from "./types";

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

function localTime(fields: ExtractionField[], prefix: "start" | "end"): JsonObject | null {
  const localDate = stringValue(fields, `${prefix}.local_date`);
  if (!localDate) return null;
  const extractedPrecision = stringValue(fields, `${prefix}.precision`);
  const precision = ["exact_time", "date_only", "unknown_time"].includes(extractedPrecision)
    ? extractedPrecision
    : "date_only";
  const localTimeValue = stringValue(fields, `${prefix}.local_time`) || null;
  const zone = stringValue(fields, `${prefix}.iana_time_zone`) || null;
  const instant = stringValue(fields, `${prefix}.instant_utc`) || null;
  const resolution = stringValue(fields, `${prefix}.resolution_status`) || precision;
  return {
    local_date: localDate,
    local_time: precision === "exact_time" ? localTimeValue : null,
    precision,
    iana_time_zone: zone,
    utc_offset_minutes: precision === "exact_time" ? offsetMinutes(stringValue(fields, `${prefix}.utc_offset`)) : null,
    instant_utc: precision === "exact_time" ? instant : null,
    resolution_status: resolution
  };
}

function typeDetails(candidate: ExtractionCandidate): JsonObject {
  const sourceType = candidate.proposedEventTypeCode === "rail" ? "train" : candidate.proposedEventTypeCode === "bus" || candidate.proposedEventTypeCode === "activity" ? "generic" : candidate.proposedEventTypeCode;
  const prefix = `details.${sourceType}.`;
  return Object.fromEntries(candidate.fields.flatMap((field) => {
    if (field.occurrenceKey || !field.fieldPath.startsWith(prefix) || field.fieldPath.includes(".segments.")) return [];
    if (field.value === null || typeof field.value === "object") return [];
    const key = field.fieldPath.slice(prefix.length);
    return key ? [[key, String(field.value)]] : [];
  }));
}

export function candidateToCanonicalPayload(candidate: ExtractionCandidate): JsonObject {
  if (candidate.canonicalPayload) return structuredClone(candidate.canonicalPayload);
  const start = localTime(candidate.fields, "start");
  const end = localTime(candidate.fields, "end");
  return {
    event_type_code: candidate.proposedEventTypeCode,
    title: stringValue(candidate.fields, "title"),
    booking_status: stringValue(candidate.fields, "booking_status") || "unknown",
    start_time: start,
    end_time: end,
    locations: {},
    common_details: {
      provider_name: stringValue(candidate.fields, "provider_name"),
      notes: "",
      references: [],
      travelers: [],
      provider_contacts: [],
      price: {},
      additional_attributes: []
    },
    type_details: typeDetails(candidate),
    segments: []
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
