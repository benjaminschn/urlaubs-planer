import type {
  LocalTimeValue,
  LocationInput,
  TravelItemPayload,
  TravelItemSegmentInput
} from "./types";

type LocalParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;

function padded(value: number): string {
  return String(value).padStart(2, "0");
}

function getTimeZoneParts(instantMs: number, timeZone: string): LocalParts | null {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      calendar: "gregory",
      numberingSystem: "latn",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23"
    });
    const values = Object.fromEntries(formatter.formatToParts(new Date(instantMs)).map((part) => [part.type, part.value]));
    return {
      year: Number(values.year),
      month: Number(values.month),
      day: Number(values.day),
      hour: Number(values.hour),
      minute: Number(values.minute),
      second: Number(values.second)
    };
  } catch {
    return null;
  }
}

function getOffsetMinutes(instantMs: number, timeZone: string): number | null {
  const parts = getTimeZoneParts(instantMs, timeZone);
  if (!parts) {
    return null;
  }
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return Math.round((asUtc - instantMs) / 60_000);
}

function localPartsEqual(parts: LocalParts, expected: LocalParts): boolean {
  return (
    parts.year === expected.year &&
    parts.month === expected.month &&
    parts.day === expected.day &&
    parts.hour === expected.hour &&
    parts.minute === expected.minute &&
    parts.second === expected.second
  );
}

function parseLocalParts(localDate: string, localTime: string): LocalParts | null {
  if (!datePattern.test(localDate) || !timePattern.test(localTime)) {
    return null;
  }
  const [year, month, day] = localDate.split("-").map(Number);
  const [hour, minute, rawSecond] = localTime.split(":").map(Number);
  const second = rawSecond ?? 0;
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute ||
    date.getUTCSeconds() !== second
  ) {
    return null;
  }
  return { year, month, day, hour, minute, second };
}

export type LocalTimeResolution = {
  value: LocalTimeValue;
  error: "ambiguous" | "nonexistent" | "invalid_zone" | "invalid_value" | null;
};

export function resolveExactLocalTime(
  localDate: string,
  localTime: string,
  ianaTimeZone: string,
  preferredOffsetMinutes?: number | null
): LocalTimeResolution {
  const localParts = parseLocalParts(localDate, localTime);
  const fallback: LocalTimeValue = {
    localDate,
    localTime,
    precision: "exact_time",
    ianaTimeZone,
    utcOffsetMinutes: null,
    instantUtc: null,
    resolutionStatus: "unresolved"
  };
  if (!localParts || !ianaTimeZone) {
    return { value: fallback, error: "invalid_value" };
  }
  const guessMs = Date.UTC(
    localParts.year,
    localParts.month - 1,
    localParts.day,
    localParts.hour,
    localParts.minute,
    localParts.second
  );
  const offsets = new Set<number>();
  for (let deltaHours = -48; deltaHours <= 48; deltaHours += 6) {
    const offset = getOffsetMinutes(guessMs + deltaHours * 3_600_000, ianaTimeZone);
    if (offset !== null) {
      offsets.add(offset);
    }
  }
  if (offsets.size === 0) {
    return { value: fallback, error: "invalid_zone" };
  }
  const candidates = [...offsets]
    .map((offset) => ({ offset, instantMs: guessMs - offset * 60_000 }))
    .filter(({ instantMs }) => {
      const parts = getTimeZoneParts(instantMs, ianaTimeZone);
      return parts ? localPartsEqual(parts, localParts) : false;
    });
  if (candidates.length === 0) {
    return {
      value: { ...fallback, resolutionStatus: "nonexistent" },
      error: "nonexistent"
    };
  }
  if (candidates.length > 1 && preferredOffsetMinutes == null) {
    return {
      value: { ...fallback, resolutionStatus: "ambiguous" },
      error: "ambiguous"
    };
  }
  const selected = candidates.find((candidate) => candidate.offset === preferredOffsetMinutes) ?? candidates[0];
  if (preferredOffsetMinutes !== null && preferredOffsetMinutes !== undefined && selected.offset !== preferredOffsetMinutes) {
    return {
      value: { ...fallback, resolutionStatus: "ambiguous" },
      error: "ambiguous"
    };
  }
  return {
    value: {
      localDate,
      localTime: `${padded(localParts.hour)}:${padded(localParts.minute)}:${padded(localParts.second)}`,
      precision: "exact_time",
      ianaTimeZone,
      utcOffsetMinutes: selected.offset,
      instantUtc: new Date(selected.instantMs).toISOString(),
      resolutionStatus: "resolved"
    },
    error: null
  };
}

export function makeDateOnlyTime(localDate: string, precision: "date_only" | "unknown_time"): LocalTimeValue {
  return {
    localDate,
    localTime: null,
    precision,
    ianaTimeZone: null,
    utcOffsetMinutes: null,
    instantUtc: null,
    resolutionStatus: precision
  };
}

export function validateLocalTime(value: LocalTimeValue | null, label: string): string | null {
  if (!value) {
    return `${label} fehlt.`;
  }
  if (!datePattern.test(value.localDate) || !parseLocalParts(value.localDate, "00:00")) {
    return `${label} benötigt ein gültiges lokales Datum.`;
  }
  if (value.precision === "exact_time") {
    if (!value.localTime || !value.ianaTimeZone) {
      return `${label} benötigt Uhrzeit und IANA-Zeitzone.`;
    }
    const resolved = resolveExactLocalTime(value.localDate, value.localTime, value.ianaTimeZone, value.utcOffsetMinutes);
    if (resolved.error === "ambiguous") {
      return `${label} ist wegen der Zeitumstellung mehrdeutig.`;
    }
    if (resolved.error === "nonexistent") {
      return `${label} existiert wegen der Zeitumstellung nicht.`;
    }
    if (resolved.error) {
      return `${label} besitzt keine gültige IANA-Zeitzone.`;
    }
    if (value.resolutionStatus !== "resolved" || value.instantUtc !== resolved.value.instantUtc) {
      return `${label} muss eindeutig aufgelöst werden.`;
    }
  } else if (value.localTime || value.instantUtc || value.utcOffsetMinutes !== null) {
    return `${label} darf bei fehlender Uhrzeit keinen UTC-Instant enthalten.`;
  }
  return null;
}

function compareLocalTimes(start: LocalTimeValue, end: LocalTimeValue): boolean {
  if (start.precision === "exact_time" && end.precision === "exact_time" && start.instantUtc && end.instantUtc) {
    return end.instantUtc >= start.instantUtc;
  }
  return end.localDate >= start.localDate;
}

function validateLocation(location: LocationInput | null, label: string, errors: Record<string, string>): void {
  if (!location) {
    return;
  }
  if (!location.name.trim()) {
    errors[label] = `${label} benötigt einen Namen.`;
  }
  if ((location.latitude === null) !== (location.longitude === null)) {
    errors[label] = `${label} benötigt beide Koordinaten oder keine.`;
  }
}

function validateSegment(segment: TravelItemSegmentInput, index: number, errors: Record<string, string>): void {
  const prefix = `segments.${index}`;
  if (segment.sequenceNumber !== index + 1) {
    errors[prefix] = "Die Teilstrecken müssen lückenlos sortiert sein.";
  }
  validateLocation(segment.startLocation, `Startort Teilstrecke ${index + 1}`, errors);
  validateLocation(segment.endLocation, `Zielort Teilstrecke ${index + 1}`, errors);
  const departureError = validateLocalTime(segment.departureTime, `Abfahrt Teilstrecke ${index + 1}`);
  const arrivalError = validateLocalTime(segment.arrivalTime, `Ankunft Teilstrecke ${index + 1}`);
  if (departureError) errors[`${prefix}.departure`] = departureError;
  if (arrivalError) errors[`${prefix}.arrival`] = arrivalError;
  if (!departureError && !arrivalError && !compareLocalTimes(segment.departureTime, segment.arrivalTime)) {
    errors[`${prefix}.order`] = "Die Ankunft darf nicht vor der Abfahrt liegen.";
  }
}

export function validateTravelItemPayload(payload: TravelItemPayload): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!payload.eventTypeCode) errors.eventTypeCode = "Wählen Sie eine Ereignisart aus.";
  if (!payload.title.trim()) errors.title = "Geben Sie einen Ereignistitel ein.";
  if (payload.title.trim().length > 240) errors.title = "Der Ereignistitel ist zu lang.";
  const startError = validateLocalTime(payload.startTime, "Der Beginn");
  if (startError) errors.startTime = startError;
  if (payload.endTime) {
    const endError = validateLocalTime(payload.endTime, "Das Ende");
    if (endError) errors.endTime = endError;
    if (!startError && !endError && !compareLocalTimes(payload.startTime, payload.endTime)) {
      errors.endTime = "Das Ende darf nicht vor dem Beginn liegen.";
    }
  }
  if (payload.commonDetails.managementUrl && !/^https?:\/\//i.test(payload.commonDetails.managementUrl)) {
    errors.managementUrl = "Links müssen mit http:// oder https:// beginnen.";
  }
  if (payload.commonDetails.bookingDate && (!datePattern.test(payload.commonDetails.bookingDate) || !parseLocalParts(payload.commonDetails.bookingDate, "00:00"))) {
    errors.bookingDate = "Das Buchungsdatum ist ungültig.";
  }
  if (payload.commonDetails.cancellationDeadline) {
    const cancellationError = validateLocalTime(payload.commonDetails.cancellationDeadline, "Die Stornierungsfrist");
    if (cancellationError) errors.cancellationDeadline = cancellationError;
  }
  validateLocation(payload.locations.main, "Hauptort", errors);
  validateLocation(payload.locations.start, "Startort", errors);
  validateLocation(payload.locations.end, "Zielort", errors);
  if (payload.segments.length === 1) {
    errors.segments = "Ein Verkehrsereignis benötigt mindestens zwei Teilstrecken.";
  }
  payload.segments.forEach((segment, index) => validateSegment(segment, index, errors));
  if (JSON.stringify(payload).match(/"(password|passwd|secret|token|api[_-]?key|cvv|cvc|card[_-]?number|iban|authorization)"\s*:/i)) {
    errors.sensitive = "Geheime oder vollständige Zahlungsdaten dürfen nicht gespeichert werden.";
  }
  return errors;
}

export function firstValidationMessage(errors: Record<string, string>): string | null {
  return Object.values(errors)[0] ?? null;
}
