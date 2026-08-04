type RecordLike = Record<string, unknown>;

export type CandidateField = {
  field_path: string;
  occurrence_key: string;
  original_value: unknown;
  provenance: "explicit" | "inferred" | "unknown";
  confidence: number | null;
  source_locator: unknown[];
};

export type CandidatePayload = {
  candidate_index: number;
  proposed_event_type_code: "accommodation" | "flight" | "rail" | "bus" | "activity";
  overall_confidence: null;
  fields: CandidateField[];
};

export type WarningPayload = {
  code: string;
  severity: string;
  event_index: number | null;
  field_path: string | null;
  message: string;
  source_locator: unknown[];
};

const genericCategoryMap: Readonly<Record<"bus" | "activity", readonly string[]>> = {
  bus: ["bus", "coach", "shuttle"],
  activity: ["activity", "tour", "excursion", "experience", "museum", "event"]
};

function asRecord(value: unknown): RecordLike | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RecordLike : null;
}

function isField(value: unknown): value is RecordLike & { provenance: string; confidence: unknown; evidence: unknown; value: unknown } {
  const row = asRecord(value);
  if (!row || !("value" in row) || !("provenance" in row) || !("confidence" in row) || !("evidence" in row)) return false;
  // Composite items reuse the same four keys but are not leaf field envelopes.
  if ("kind" in row || "label" in row || ("role" in row && ("phone" in row || "email" in row || "website" in row))) {
    return false;
  }
  const provenance = row.provenance;
  return provenance === "explicit" || provenance === "inferred" || provenance === "unknown";
}

function hasForbiddenSecret(value: unknown): boolean {
  if (typeof value === "string") {
    const digits = value.replace(/[\s-]/g, "");
    return /(?:\b\d[ -]?){13,19}\b/.test(value) || /^(?:\d){13,19}$/.test(digits) || /\b(?:sk-|sb_secret_|ghp_)[A-Za-z0-9_-]{10,}/i.test(value);
  }
  if (Array.isArray(value)) return value.some(hasForbiddenSecret);
  const row = asRecord(value);
  return row ? Object.values(row).some(hasForbiddenSecret) : false;
}

function fieldValue(parent: RecordLike | null, key: string): unknown {
  const field = parent ? asRecord(parent[key]) : null;
  return field?.value;
}

/** Treat blank strings as null so model-emitted "" does not fail format checks. */
function normalizedScalar(value: unknown): unknown {
  if (typeof value !== "string") return value ?? null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function isValidLocalDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isValidLocalTime(value: string): boolean {
  // HH:mm, HH:mm:ss, optional fractional seconds
  return /^\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/.test(value);
}

function isValidIanaZone(value: string): boolean {
  if (value === "UTC" || value === "Etc/UTC" || value === "Etc/GMT") return true;
  return /^[A-Za-z]+(?:[_+-][A-Za-z0-9]+)*\/[A-Za-z0-9_+-]+(?:\/[A-Za-z0-9_+-]+)*$/.test(value);
}

function isValidUtcOffset(value: string): boolean {
  // +HH:MM, -HH:MM, +HHMM, Z
  return value === "Z" || value === "z" || /^[+-](?:0\d|1\d|2[0-3])(?::?[0-5]\d)$/.test(value);
}

function isValidInstant(value: string): boolean {
  // Accept Z and numeric-offset RFC3339 forms; models rarely emit only Z.
  if (Number.isNaN(Date.parse(value))) return false;
  return (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)
  );
}

function validateTime(time: unknown): boolean {
  const row = asRecord(time);
  if (!row) return false;
  const date = normalizedScalar(fieldValue(row, "local_date"));
  const localTime = normalizedScalar(fieldValue(row, "local_time"));
  const precision = normalizedScalar(fieldValue(row, "precision"));
  const zone = normalizedScalar(fieldValue(row, "iana_time_zone"));
  const offset = normalizedScalar(fieldValue(row, "utc_offset"));
  const instant = normalizedScalar(fieldValue(row, "instant_utc"));
  const resolution = normalizedScalar(fieldValue(row, "resolution_status"));

  if (date !== null && (typeof date !== "string" || !isValidLocalDate(date))) return false;
  if (localTime !== null && (typeof localTime !== "string" || !isValidLocalTime(localTime))) return false;
  if (zone !== null && (typeof zone !== "string" || !isValidIanaZone(zone))) return false;
  if (offset !== null && (typeof offset !== "string" || !isValidUtcOffset(offset))) return false;
  if (instant !== null && (typeof instant !== "string" || !isValidInstant(instant))) return false;
  if (
    resolution !== null
    && (typeof resolution !== "string"
      || !["resolved", "date_only", "ambiguous", "nonexistent", "unresolved"].includes(resolution))
  ) {
    return false;
  }

  // Fully unknown / empty time block is valid.
  if (
    date === null
    && localTime === null
    && (precision === null || precision === "unknown_time")
    && zone === null
    && offset === null
    && instant === null
  ) {
    return true;
  }

  // Any concrete time component requires a local date (contract).
  if (typeof date !== "string") return false;

  // Date + local time: accept even if the model mislabeled precision as date_only.
  // Incomplete zone/offset/instant is allowed; "resolved" without a full set is tolerated
  // (stored values stay as-is for human review — we do not invent missing components).
  if (typeof localTime === "string") return true;

  // Date without clock time: allow optional zone; drop the hard ban on stray instants
  // only when precision claims pure date — a lone instant without local time is still rejected.
  if (instant !== null) return false;
  return precision === null
    || precision === "date_only"
    || precision === "unknown_time"
    || precision === "exact_time";
}

/**
 * Coerce slightly imperfect field envelopes into a storable candidate field.
 * Hard-reject only impossible provenance values; normalize common model drift
 * (empty evidence, null confidence, blank strings, unknown/value mismatches).
 */
function adaptField(
  field: RecordLike,
  path: string,
  occurrenceKey: string
): CandidateField | "semantics_field" | "semantics_secret" {
  if (hasForbiddenSecret(field.value)) return "semantics_secret";

  let provenance = field.provenance;
  if (provenance !== "explicit" && provenance !== "inferred" && provenance !== "unknown") {
    return "semantics_field";
  }

  let value: unknown = field.value;
  if (typeof value === "string" && value.trim() === "") value = null;

  let confidence: number | null = null;
  if (typeof field.confidence === "number" && Number.isFinite(field.confidence)) {
    confidence = Math.min(1, Math.max(0, field.confidence));
  } else if (typeof field.confidence === "string" && field.confidence.trim() !== "") {
    const parsed = Number(field.confidence);
    if (Number.isFinite(parsed)) confidence = Math.min(1, Math.max(0, parsed));
  }

  const evidence = Array.isArray(field.evidence) ? field.evidence : [];

  if (value === null || value === undefined) {
    provenance = "unknown";
    confidence = null;
    value = null;
  } else if (provenance === "unknown") {
    // Model supplied a value but marked unknown — keep value for human review.
    provenance = "inferred";
  }

  return {
    field_path: path,
    occurrence_key: occurrenceKey,
    original_value: value,
    provenance: provenance as CandidateField["provenance"],
    confidence: provenance === "unknown" ? null : confidence,
    source_locator: provenance === "unknown" ? [] : evidence
  };
}

type FieldCollectResult = "ok" | "semantics_field" | "semantics_secret";

function collectFields(value: unknown, path: string, occurrenceKey: string, output: CandidateField[]): FieldCollectResult {
  if (isField(value)) {
    const adapted = adaptField(value, path, occurrenceKey);
    if (adapted === "semantics_field" || adapted === "semantics_secret") return adapted;
    output.push(adapted);
    return "ok";
  }
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const result = collectFields(item, path, occurrenceKey ? `${occurrenceKey}.${index}` : `${path}:${index}`, output);
      if (result !== "ok") return result;
    }
    return "ok";
  }
  const row = asRecord(value);
  if (!row) return hasForbiddenSecret(value) ? "semantics_secret" : "ok";
  for (const [key, item] of Object.entries(row)) {
    // Structural event index is not a leaf field envelope.
    if (key === "event_index" && path === "") continue;
    const result = collectFields(item, path ? `${path}.${key}` : key, occurrenceKey, output);
    if (result !== "ok") return result;
  }
  return "ok";
}

function mappedType(event: RecordLike): CandidatePayload["proposed_event_type_code"] | null {
  const eventType = fieldValue(event, "event_type");
  if (eventType === "accommodation" || eventType === "flight") return eventType;
  if (eventType === "train") return "rail";
  if (eventType !== "generic") return null;
  const details = asRecord(event.details);
  const generic = details ? asRecord(details.generic) : null;
  const category = typeof fieldValue(generic, "category") === "string" ? String(fieldValue(generic, "category")).trim().toLowerCase() : "";
  const categoryField = generic ? asRecord(generic.category) : null;
  if (!categoryField || categoryField.provenance !== "explicit" || !Array.isArray(categoryField.evidence) || categoryField.evidence.length === 0) return null;
  if (genericCategoryMap.bus.includes(category)) return "bus";
  if (genericCategoryMap.activity.includes(category)) return "activity";
  return null;
}

function normalizeEventOrder(events: unknown[]): { ordered: Array<{ event: RecordLike; sourceIndex: number }> } | { error: string } {
  const prepared: Array<{ event: RecordLike; sourceIndex: number; eventIndex: number }> = [];
  for (const [sourceIndex, rawEvent] of events.entries()) {
    const event = asRecord(rawEvent);
    if (!event || typeof event.event_index !== "number" || !Number.isInteger(event.event_index) || event.event_index < 0) {
      return { error: "semantics_event_index" };
    }
    prepared.push({ event, sourceIndex, eventIndex: event.event_index });
  }
  const unique = new Set(prepared.map((item) => item.eventIndex));
  if (unique.size !== prepared.length) return { error: "semantics_event_index" };

  // Models sometimes emit 1-based indices. Accept any unique non-negative set and
  // re-canonicalize to 0..n-1 in ascending event_index order (stable by source order).
  prepared.sort((left, right) => left.eventIndex - right.eventIndex || left.sourceIndex - right.sourceIndex);
  return {
    ordered: prepared.map((item) => ({ event: item.event, sourceIndex: item.sourceIndex }))
  };
}

export function validateAndAdapt(raw: unknown): { candidates: CandidatePayload[]; warnings: WarningPayload[] } | { error: string } {
  const result = asRecord(raw);
  const events = Array.isArray(result?.events) ? result.events : [];
  const warnings = Array.isArray(result?.warnings) ? result.warnings : [];
  if (
    (result?.result === "completed" && events.length === 0)
    || (result?.result === "no_relevant_events" && events.length !== 0)
    || (result?.result === "partial" && warnings.length === 0)
  ) {
    return { error: "semantics_result_shape" };
  }

  const normalized = normalizeEventOrder(events);
  if ("error" in normalized) return normalized;

  // Map original model event_index → canonical candidate index for warning rewrites.
  const indexMap = new Map<number, number>();
  for (const [candidateIndex, item] of normalized.ordered.entries()) {
    indexMap.set(item.event.event_index as number, candidateIndex);
  }

  const candidatePayloads: CandidatePayload[] = [];
  const warningPayloads: WarningPayload[] = [];
  for (const [candidateIndex, { event }] of normalized.ordered.entries()) {
    if (!validateTime(event.start) || !validateTime(event.end) || !validateTime(event.cancellation_deadline)) {
      return { error: "semantics_time" };
    }
    const type = mappedType(event);
    if (!type) {
      warningPayloads.push({
        code: "unsupported_event_kind",
        severity: "review",
        event_index: candidateIndex,
        field_path: "details.generic.category",
        message: "Dieser Vorschlag konnte keiner unterstützten Ereignisart zugeordnet werden.",
        source_locator: []
      });
      continue;
    }
    const fields: CandidateField[] = [];
    const fieldResult = collectFields(event, "", "", fields);
    if (fieldResult !== "ok") return { error: fieldResult };
    const title = fields.find((field) => field.field_path === "title" && field.occurrence_key === "");
    if (!title || typeof title.original_value !== "string" || !title.original_value.trim()) {
      return { error: "semantics_title" };
    }
    candidatePayloads.push({
      candidate_index: candidateIndex,
      proposed_event_type_code: type,
      overall_confidence: null,
      fields
    });
  }
  for (const rawWarning of warnings) {
    const warning = asRecord(rawWarning);
    if (
      !warning
      || typeof warning.code !== "string"
      || typeof warning.severity !== "string"
      || typeof warning.message !== "string"
      || !Array.isArray(warning.evidence)
    ) {
      return { error: "semantics_warning" };
    }
    const originalIndex = typeof warning.event_index === "number" ? warning.event_index : null;
    const mappedIndex = originalIndex === null ? null : (indexMap.get(originalIndex) ?? null);
    warningPayloads.push({
      code: warning.code,
      severity: warning.severity,
      event_index: mappedIndex,
      field_path: typeof warning.field_path === "string" ? warning.field_path : null,
      message: warning.message,
      source_locator: warning.evidence
    });
  }
  return { candidates: candidatePayloads, warnings: warningPayloads };
}
