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

function isField(value: unknown): value is RecordLike & { provenance: string; confidence: unknown; evidence: unknown[]; value: unknown } {
  const row = asRecord(value);
  return Boolean(row && "value" in row && "provenance" in row && "confidence" in row && Array.isArray(row.evidence));
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

function validateTime(time: unknown): boolean {
  const row = asRecord(time);
  if (!row) return false;
  const date = fieldValue(row, "local_date");
  const localTime = fieldValue(row, "local_time");
  const precision = fieldValue(row, "precision");
  const zone = fieldValue(row, "iana_time_zone");
  const offset = fieldValue(row, "utc_offset");
  const instant = fieldValue(row, "instant_utc");
  const resolution = fieldValue(row, "resolution_status");
  if (date !== null && (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date))) return false;
  if (localTime !== null && (typeof localTime !== "string" || !/^\d{2}:\d{2}(?::\d{2})?$/.test(localTime))) return false;
  if (zone !== null && (typeof zone !== "string" || !/^[A-Za-z]+(?:[_+-][A-Za-z]+)*\/[A-Za-z_+-]+(?:\/[A-Za-z_+-]+)*$/.test(zone))) return false;
  if (offset !== null && (typeof offset !== "string" || !/^[+-](?:0\d|1\d|2[0-3]):[0-5]\d$/.test(offset))) return false;
  if (instant !== null && (typeof instant !== "string" || Number.isNaN(Date.parse(instant)) || !instant.endsWith("Z"))) return false;
  if (precision === "exact_time") return typeof date === "string" && typeof localTime === "string" && typeof zone === "string" && typeof offset === "string" && typeof instant === "string" && resolution === "resolved";
  if (precision === "date_only" || precision === "unknown_time") return typeof date === "string" && localTime === null && instant === null;
  return precision === null && date === null && localTime === null && zone === null && offset === null && instant === null;
}

function validateField(field: RecordLike): boolean {
  const value = field.value;
  const provenance = field.provenance;
  const confidence = field.confidence;
  const evidence = field.evidence;
  if (provenance === "unknown") return value === null && confidence === null && Array.isArray(evidence) && evidence.length === 0;
  return (provenance === "explicit" || provenance === "inferred")
    && value !== null
    && typeof confidence === "number"
    && Number.isFinite(confidence)
    && confidence >= 0
    && confidence <= 1
    && Array.isArray(evidence)
    && evidence.length > 0;
}

function collectFields(value: unknown, path: string, occurrenceKey: string, output: CandidateField[]): boolean {
  if (isField(value)) {
    if (!validateField(value)) return false;
    output.push({
      field_path: path,
      occurrence_key: occurrenceKey,
      original_value: value.value,
      provenance: value.provenance as CandidateField["provenance"],
      confidence: typeof value.confidence === "number" ? value.confidence : null,
      source_locator: value.evidence
    });
    return !hasForbiddenSecret(value.value);
  }
  if (Array.isArray(value)) return value.every((item, index) => collectFields(item, path, occurrenceKey ? `${occurrenceKey}.${index}` : `${path}:${index}`, output));
  const row = asRecord(value);
  return row ? Object.entries(row).every(([key, item]) => collectFields(item, path ? `${path}.${key}` : key, occurrenceKey, output)) : !hasForbiddenSecret(value);
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

export function validateAndAdapt(raw: unknown): { candidates: CandidatePayload[]; warnings: WarningPayload[] } | { error: string } {
  const result = asRecord(raw);
  const events = Array.isArray(result?.events) ? result.events : [];
  const warnings = Array.isArray(result?.warnings) ? result.warnings : [];
  if ((result?.result === "completed" && events.length === 0) || (result?.result === "no_relevant_events" && events.length !== 0) || (result?.result === "partial" && warnings.length === 0)) return { error: "invalid_extraction_semantics" };
  const candidatePayloads: CandidatePayload[] = [];
  const warningPayloads: WarningPayload[] = [];
  for (const [eventPosition, rawEvent] of events.entries()) {
    const event = asRecord(rawEvent);
    if (!event || typeof event.event_index !== "number" || event.event_index !== eventPosition) return { error: "invalid_extraction_semantics" };
    if (!validateTime(event.start) || !validateTime(event.end) || !validateTime(event.cancellation_deadline)) return { error: "invalid_extraction_semantics" };
    const type = mappedType(event);
    if (!type) {
      warningPayloads.push({ code: "unsupported_event_kind", severity: "review", event_index: event.event_index, field_path: "details.generic.category", message: "Dieser Vorschlag konnte keiner unterstützten Ereignisart zugeordnet werden.", source_locator: [] });
      continue;
    }
    const fields: CandidateField[] = [];
    if (!collectFields(event, "", "", fields)) return { error: "invalid_extraction_semantics" };
    const title = fields.find((field) => field.field_path === "title" && field.occurrence_key === "");
    if (!title || typeof title.original_value !== "string" || !title.original_value.trim()) return { error: "invalid_extraction_semantics" };
    candidatePayloads.push({ candidate_index: event.event_index, proposed_event_type_code: type, overall_confidence: null, fields });
  }
  for (const rawWarning of warnings) {
    const warning = asRecord(rawWarning);
    if (!warning || typeof warning.code !== "string" || typeof warning.severity !== "string" || typeof warning.message !== "string" || !Array.isArray(warning.evidence)) return { error: "invalid_extraction_semantics" };
    warningPayloads.push({
      code: warning.code,
      severity: warning.severity,
      event_index: typeof warning.event_index === "number" ? warning.event_index : null,
      field_path: typeof warning.field_path === "string" ? warning.field_path : null,
      message: warning.message,
      source_locator: warning.evidence
    });
  }
  return { candidates: candidatePayloads, warnings: warningPayloads };
}
