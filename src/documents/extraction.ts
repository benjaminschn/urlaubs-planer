import type { ExtractionCandidate, ExtractionField, ExtractionRun, ExtractionWarning } from "./types";

export const extractionStatusLabels: Record<ExtractionRun["status"], string> = {
  queued: "Wartet auf Verarbeitung",
  processing: "Wird verarbeitet",
  succeeded: "Entwürfe bereit",
  failed_retryable: "Verarbeitung fehlgeschlagen",
  failed_terminal: "Verarbeitung fehlgeschlagen",
  expired: "Verarbeitung abgelaufen"
};

export const extractionErrorMessages: Record<string, string> = {
  extraction_disabled: "Die Verarbeitung ist derzeit nicht verfügbar.",
  extraction_active: "Dieses Dokument wird bereits verarbeitet.",
  extraction_limit: "Das Tageslimit für Verarbeitungen ist erreicht.",
  extraction_parallel_limit: "Die Verarbeitungskapazität ist derzeit belegt. Bitte versuchen Sie es später erneut.",
  budget_exhausted: "Das monatliche Verarbeitungsbudget ist erreicht.",
  invalid_structured_output: "Die Verarbeitung lieferte kein gültiges Ergebnis. Bitte versuchen Sie es später erneut.",
  invalid_extraction_semantics: "Die erkannten Angaben konnten nicht sicher übernommen werden.",
  provider_unavailable: "Die Verarbeitung ist vorübergehend nicht erreichbar. Bitte versuchen Sie es später erneut.",
  provider_timeout: "Die Verarbeitung hat zu lange gedauert. Bitte versuchen Sie es erneut.",
  forbidden: "Das Dokument ist nicht verfügbar.",
  unknown: "Die Verarbeitung konnte nicht gestartet werden. Bitte versuchen Sie es erneut."
};

export function extractionErrorMessage(code: string | null | undefined): string {
  return extractionErrorMessages[code ?? "unknown"] ?? extractionErrorMessages.unknown;
}

export function fieldValue(candidate: ExtractionCandidate, fieldPath: string): string | null {
  const field = candidate.fields.find((item) => item.fieldPath === fieldPath && item.occurrenceKey === "");
  if (!field || field.value === null || field.value === undefined) return null;
  return typeof field.value === "string" ? field.value : String(field.value);
}

export function candidateTitle(candidate: ExtractionCandidate): string {
  return fieldValue(candidate, "title") ?? "Ohne erkannten Titel";
}

export function candidateStartDate(candidate: ExtractionCandidate): string | null {
  return fieldValue(candidate, "start.local_date");
}

export function candidateWarnings(run: ExtractionRun, candidate: ExtractionCandidate): ExtractionWarning[] {
  return [...run.warnings.filter((warning) => warning.fieldPath === null), ...candidate.warnings];
}

export function candidateFieldSummary(field: ExtractionField): string {
  if (field.value === null) return "Unbekannt";
  if (Array.isArray(field.value)) return field.value.join(", ");
  return typeof field.value === "string" ? field.value : String(field.value);
}
