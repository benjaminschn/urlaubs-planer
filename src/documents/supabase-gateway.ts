import type { SupabaseClient } from "@supabase/supabase-js";
import { documentErrorMessage } from "./validation";
import { extractionErrorMessage } from "./extraction";
import { DOCUMENT_BUCKET } from "./types";
import type {
  Document,
  DocumentDownloadResult,
  DocumentGateway,
  DocumentLoadResult,
  DocumentRealtimeStatus,
  DocumentUploadInput,
  DocumentUploadResult,
  CandidateMutationResult,
  ExtractionCandidate,
  ExtractionField,
  ExtractionLoadResult,
  ExtractionRun,
  ExtractionStartResult,
  ExtractionWarning
} from "./types";

const documentColumns = [
  "id",
  "trip_id",
  "uploaded_by_user_id",
  "original_file_name",
  "reported_content_type",
  "detected_content_type",
  "byte_size",
  "checksum",
  "storage_object_key",
  "status",
  "error_code",
  "version",
  "created_at",
  "updated_at",
  "uploaded_at"
].join(",");

type RecordLike = Record<string, unknown>;

const extractionRunColumns = [
  "id", "document_id", "status", "error_code", "provider_attempt_count", "created_at", "updated_at", "completed_at"
].join(",");
const extractionCandidateColumns = ["id", "extraction_run_id", "candidate_index", "proposed_event_type_code", "status", "version"].join(",");
const extractionFieldColumns = ["candidate_id", "field_path", "occurrence_key", "original_value", "provenance", "confidence", "source_locator"].join(",");
const extractionWarningColumns = ["extraction_run_id", "candidate_id", "warning_code", "severity", "field_path", "message"].join(",");
const candidateCorrectionColumns = ["candidate_id", "field_path", "occurrence_key", "operation", "new_value", "candidate_version_after"].join(",");
const candidateConfirmationColumns = ["candidate_id", "travel_item_id"].join(",");

function asRecord(value: unknown): RecordLike | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as RecordLike) : null;
}

async function readFunctionErrorCode(error: unknown): Promise<string | undefined> {
  const context = asRecord(asRecord(error)?.context);
  if (!context) return undefined;
  const response = typeof context.clone === "function" ? context.clone() : context;
  if (!response || typeof response.json !== "function") return undefined;
  try {
    const body = asRecord(await response.json());
    return typeof body?.code === "string" ? body.code : undefined;
  } catch {
    return undefined;
  }
}

function firstRow(value: unknown): RecordLike | null {
  return Array.isArray(value) ? asRecord(value[0]) : asRecord(value);
}

function mapLocator(value: unknown): ExtractionField["sourceLocator"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const row = asRecord(item);
    if (!row || typeof row.source_hint !== "string") return [];
    return [{ pageNumber: typeof row.page_number === "number" ? row.page_number : null, sourceHint: row.source_hint }];
  });
}

function mapField(value: unknown): ExtractionField | null {
  const row = asRecord(value);
  if (!row || typeof row.candidate_id !== "string" || typeof row.field_path !== "string" || typeof row.occurrence_key !== "string") return null;
  if (!(row.provenance === "explicit" || row.provenance === "inferred" || row.provenance === "unknown")) return null;
  return {
    fieldPath: row.field_path,
    occurrenceKey: row.occurrence_key,
    originalValue: row.original_value,
    value: row.original_value,
    provenance: row.provenance,
    confidence: typeof row.confidence === "number" ? row.confidence : null,
    sourceLocator: mapLocator(row.source_locator)
  };
}

function mapWarning(value: unknown): { runId: string; candidateId: string | null; warning: ExtractionWarning } | null {
  const row = asRecord(value);
  if (!row || typeof row.extraction_run_id !== "string" || typeof row.warning_code !== "string" || typeof row.message !== "string") return null;
  if (!(row.severity === "info" || row.severity === "review" || row.severity === "blocking")) return null;
  return {
    runId: row.extraction_run_id,
    candidateId: typeof row.candidate_id === "string" ? row.candidate_id : null,
    warning: { code: row.warning_code, severity: row.severity, fieldPath: typeof row.field_path === "string" ? row.field_path : null, message: row.message }
  };
}

function mapCandidate(value: unknown, fields: ExtractionField[], warnings: ExtractionWarning[], canonicalPayload: RecordLike | null, confirmedTravelItemId: string | null): ExtractionCandidate | null {
  const row = asRecord(value);
  if (!row || typeof row.id !== "string" || typeof row.candidate_index !== "number" || typeof row.proposed_event_type_code !== "string" || typeof row.version !== "number") return null;
  const eventTypes = ["accommodation", "flight", "rail", "bus", "activity"] as const;
  const statuses = ["draft", "confirmed", "discarded", "superseded"] as const;
  if (!eventTypes.includes(row.proposed_event_type_code as (typeof eventTypes)[number]) || !statuses.includes(row.status as (typeof statuses)[number])) return null;
  return {
    id: row.id,
    candidateIndex: row.candidate_index,
    proposedEventTypeCode: row.proposed_event_type_code as ExtractionCandidate["proposedEventTypeCode"],
    status: row.status as ExtractionCandidate["status"],
    version: row.version,
    canonicalPayload,
    confirmedTravelItemId,
    fields,
    warnings
  };
}

function mapCandidateMutation(data: unknown, error: { code?: string; message?: string } | null): CandidateMutationResult {
  const row = firstRow(data);
  const status = typeof row?.operation_status === "string" ? row.operation_status : null;
  const candidateId = typeof row?.candidate_id === "string" ? row.candidate_id : null;
  const version = typeof row?.version === "number" ? row.version : null;
  const code = typeof row?.error_code === "string" ? row.error_code : undefined;
  const message = typeof row?.error_message === "string" ? row.error_message : null;
  if ((status === "updated" || status === "discarded") && candidateId && version !== null) return { kind: status, candidateId, version };
  if ((status === "created" || status === "replayed") && candidateId && version !== null && typeof row?.travel_item_id === "string") {
    return { kind: status, candidateId, travelItemId: row.travel_item_id, version };
  }
  if (status === "conflict" && candidateId && version !== null) return { kind: "conflict", candidateId, version, message: message ?? "Der Entwurf wurde zwischenzeitlich geändert." };
  if (status === "validation" || status === "limit" || status === "forbidden" || status === "unavailable") {
    return { kind: status, code, message: message ?? "Der Entwurf konnte nicht gespeichert werden." };
  }
  if (error?.code === "42501") return { kind: "forbidden", message: "Der Entwurf ist nicht verfügbar." };
  return { kind: "unavailable", message: "Der Speicherstatus konnte nicht bestätigt werden." };
}

function mapRun(value: unknown, candidates: ExtractionCandidate[], warnings: ExtractionWarning[]): ExtractionRun | null {
  const row = asRecord(value);
  if (!row || typeof row.id !== "string" || typeof row.document_id !== "string" || typeof row.status !== "string" || typeof row.provider_attempt_count !== "number" || typeof row.created_at !== "string" || typeof row.updated_at !== "string") return null;
  const statuses = ["queued", "processing", "succeeded", "failed_retryable", "failed_terminal", "expired"];
  if (!statuses.includes(row.status)) return null;
  return {
    id: row.id,
    documentId: row.document_id,
    status: row.status as ExtractionRun["status"],
    errorCode: typeof row.error_code === "string" ? row.error_code : null,
    providerAttemptCount: row.provider_attempt_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: typeof row.completed_at === "string" ? row.completed_at : null,
    candidates: candidates.sort((left, right) => left.candidateIndex - right.candidateIndex),
    warnings
  };
}

function mapDocument(value: unknown): Document | null {
  const row = asRecord(value);
  if (
    !row ||
    typeof row.id !== "string" ||
    typeof row.trip_id !== "string" ||
    typeof row.uploaded_by_user_id !== "string" ||
    typeof row.original_file_name !== "string" ||
    typeof row.byte_size !== "number" ||
    typeof row.storage_object_key !== "string" ||
    typeof row.status !== "string" ||
    typeof row.version !== "number" ||
    typeof row.created_at !== "string" ||
    typeof row.updated_at !== "string"
  ) {
    return null;
  }
  const validStatuses = ["uploading", "uploaded", "verifying", "verification_pending", "available", "upload_failed", "unsupported", "invalid", "deleted"];
  if (!validStatuses.includes(row.status)) return null;
  return {
    id: row.id,
    tripId: row.trip_id,
    uploadedByUserId: row.uploaded_by_user_id,
    originalFileName: row.original_file_name,
    reportedContentType: typeof row.reported_content_type === "string" ? row.reported_content_type : null,
    detectedContentType: typeof row.detected_content_type === "string" ? row.detected_content_type : null,
    byteSize: row.byte_size,
    checksum: typeof row.checksum === "string" ? row.checksum : null,
    storageObjectKey: row.storage_object_key,
    status: row.status as Document["status"],
    errorCode: typeof row.error_code === "string" ? row.error_code : null,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    uploadedAt: typeof row.uploaded_at === "string" ? row.uploaded_at : null
  };
}

function mapStableError(error: { code?: string; message?: string } | null | undefined): {
  kind: "limit" | "validation" | "forbidden" | "unavailable";
  code?: string;
  message: string;
} {
  const code = error?.code ?? "";
  const message = error?.message ?? "";
  if (code === "42501" || message.includes("nicht berechtigt")) {
    return { kind: "forbidden", code: "forbidden", message: documentErrorMessage("forbidden") };
  }
  if (code === "P0001") {
    const knownCode = message.match(/\[([a-z_]+)\]/)?.[1] ?? "unknown";
    if (["document_limit", "parallel_limit", "selection_too_large", "selection_too_many"].includes(knownCode)) {
      return { kind: "limit", code: knownCode, message: documentErrorMessage(knownCode) };
    }
    return { kind: "validation", code: knownCode, message: documentErrorMessage(knownCode) };
  }
  return { kind: "unavailable", message: documentErrorMessage("unknown") };
}

function mapDocumentResult(data: unknown, error: { code?: string; message?: string } | null | undefined): DocumentUploadResult {
  if (error) {
    const mapped = mapStableError(error);
    if (mapped.kind === "limit") return { kind: "limit", message: mapped.message, code: mapped.code };
    if (mapped.kind === "validation") return { kind: "validation", message: mapped.message, code: mapped.code };
    if (mapped.kind === "forbidden") return { kind: "failed", message: mapped.message, code: mapped.code };
    return { kind: "unavailable", message: mapped.message };
  }
  const document = mapDocument(firstRow(data));
  if (!document) return { kind: "unavailable", message: documentErrorMessage("unknown") };
  if (document.status === "available") return { kind: "available", document };
  if (["unsupported", "invalid", "upload_failed"].includes(document.status)) {
    return { kind: "failed", document, message: documentErrorMessage(document.errorCode), code: document.errorCode ?? undefined };
  }
  return { kind: "unavailable", message: documentErrorMessage("verification_unavailable") };
}

function mapRealtimeStatus(status: string): DocumentRealtimeStatus {
  return status === "SUBSCRIBED"
    ? "connected"
    : status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED"
      ? "disconnected"
      : "connecting";
}

export function createSupabaseDocumentGateway(client: SupabaseClient): DocumentGateway {
  async function getDocument(tripId: string, documentId: string): Promise<Document | null> {
    const { data, error } = await client
      .from("documents")
      .select(documentColumns)
      .eq("trip_id", tripId)
      .eq("id", documentId)
      .maybeSingle();
    return error ? null : mapDocument(data);
  }

  async function verifyExistingDocument(tripId: string, documentId: string): Promise<DocumentUploadResult> {
    const { error: verificationError } = await client.functions.invoke("verify-document-upload", {
      body: { document_id: documentId }
    });
    const verifiedDocument = await getDocument(tripId, documentId);
    if (verifiedDocument?.status === "available") return { kind: "available", document: verifiedDocument };
    if (verifiedDocument && ["unsupported", "invalid", "upload_failed"].includes(verifiedDocument.status)) {
      return { kind: "failed", document: verifiedDocument, message: documentErrorMessage(verifiedDocument.errorCode), code: verifiedDocument.errorCode ?? undefined };
    }
    if (verifiedDocument?.status === "verification_pending" || verificationError) {
      return { kind: "unavailable", message: documentErrorMessage("verification_unavailable") };
    }
    return { kind: "unavailable", message: documentErrorMessage("verification_unavailable") };
  }

  return {
    async listDocuments(tripId: string): Promise<DocumentLoadResult> {
      const { data, error } = await client
        .from("documents")
        .select(documentColumns)
        .eq("trip_id", tripId)
        .neq("status", "deleted")
        .order("created_at", { ascending: false });
      if (error || !Array.isArray(data)) return { kind: "unavailable" };
      const documents = data.map(mapDocument);
      return documents.every((document): document is Document => document !== null)
        ? { kind: "ready", documents }
        : { kind: "unavailable" };
    },

    async uploadDocument(input: DocumentUploadInput): Promise<DocumentUploadResult> {
      const { data: reservationData, error: reservationError } = await client.rpc("reserve_document_upload", {
        p_trip_id: input.tripId,
        p_original_file_name: input.file.name,
        p_reported_content_type: input.file.type || null,
        p_byte_size: input.file.size,
        p_upload_idempotency_key: input.idempotencyKey,
        p_batch_key: input.batchKey,
        p_batch_file_count: input.batchFileCount,
        p_batch_total_bytes: input.batchTotalBytes
      });
      if (reservationError) return mapDocumentResult(null, reservationError);
      const reservedDocument = mapDocument(firstRow(reservationData));
      if (!reservedDocument) return { kind: "unavailable", message: documentErrorMessage("unknown") };
      if (reservedDocument.status === "available") return { kind: "available", document: reservedDocument };
      let uploadDocument: Document | null = reservedDocument;
      if (reservedDocument.status === "upload_failed") {
        const { data: retryData, error: retryError } = await client.rpc("prepare_document_upload_retry", {
          p_document_id: reservedDocument.id,
          p_expected_version: reservedDocument.version
        });
        uploadDocument = mapDocument(firstRow(retryData));
        if (retryError || !uploadDocument || uploadDocument.status !== "uploading") {
          return { kind: "failed", document: reservedDocument, message: documentErrorMessage("upload_failed"), code: "upload_failed" };
        }
      }
      if (uploadDocument.status !== "uploading") {
        return { kind: "failed", document: uploadDocument, message: documentErrorMessage(uploadDocument.errorCode) };
      }

      const { error: uploadError } = await client.storage.from(DOCUMENT_BUCKET).upload(
        uploadDocument.storageObjectKey,
        input.file,
        { contentType: input.file.type || "application/octet-stream", cacheControl: "no-store", upsert: false }
      );
      if (uploadError) {
        const { data: failedData, error: failedError } = await client.rpc("mark_document_upload_failed", {
          p_document_id: uploadDocument.id,
          p_expected_version: uploadDocument.version,
          p_error_code: "upload_failed"
        });
        const failedDocument = mapDocument(firstRow(failedData));
        if (failedDocument) return { kind: "failed", document: failedDocument, message: documentErrorMessage("upload_failed"), code: "upload_failed" };
        return failedError
          ? { kind: "unavailable", message: documentErrorMessage("upload_failed") }
          : { kind: "failed", document: uploadDocument, message: documentErrorMessage("upload_failed"), code: "upload_failed" };
      }

      return verifyExistingDocument(input.tripId, reservedDocument.id);
    },

    retryVerification(input) {
      return verifyExistingDocument(input.tripId, input.documentId);
    },

    async listExtractions(tripId: string): Promise<ExtractionLoadResult> {
      const { data: documents, error: documentError } = await client.from("documents").select("id").eq("trip_id", tripId).neq("status", "deleted");
      if (documentError || !Array.isArray(documents)) return { kind: "unavailable" };
      const documentIds = documents.map((document) => asRecord(document)?.id).filter((id): id is string => typeof id === "string");
      if (documentIds.length === 0) return { kind: "ready", runs: [] };
      const { data: runRows, error: runError } = await client.from("extraction_runs").select(extractionRunColumns).in("document_id", documentIds).order("created_at", { ascending: false });
      if (runError || !Array.isArray(runRows)) return { kind: "unavailable" };
      const runIds = runRows.map((run) => asRecord(run)?.id).filter((id): id is string => typeof id === "string");
      if (runIds.length === 0) return { kind: "ready", runs: [] };
      const [{ data: candidateRows, error: candidateError }, { data: warningRows, error: warningError }] = await Promise.all([
        client.from("extraction_candidates").select(extractionCandidateColumns).in("extraction_run_id", runIds),
        client.from("extraction_run_warnings").select(extractionWarningColumns).in("extraction_run_id", runIds)
      ]);
      if (candidateError || warningError || !Array.isArray(candidateRows) || !Array.isArray(warningRows)) return { kind: "unavailable" };
      const candidateIds = candidateRows.map((candidate) => asRecord(candidate)?.id).filter((id): id is string => typeof id === "string");
      const [{ data: fieldRows, error: fieldError }, { data: correctionRows, error: correctionError }, { data: confirmationRows, error: confirmationError }] = candidateIds.length > 0
        ? await Promise.all([
            client.from("candidate_fields").select(extractionFieldColumns).in("candidate_id", candidateIds),
            client.from("candidate_corrections").select(candidateCorrectionColumns).in("candidate_id", candidateIds).order("candidate_version_after", { ascending: true }),
            client.from("candidate_confirmations").select(candidateConfirmationColumns).in("candidate_id", candidateIds)
          ])
        : [{ data: [], error: null }, { data: [], error: null }, { data: [], error: null }];
      if (fieldError || correctionError || confirmationError || !Array.isArray(fieldRows) || !Array.isArray(correctionRows) || !Array.isArray(confirmationRows)) return { kind: "unavailable" };
      const fieldsByCandidate = new Map<string, ExtractionField[]>();
      for (const row of fieldRows) {
        const field = mapField(row);
        const candidateId = asRecord(row)?.candidate_id;
        if (!field || typeof candidateId !== "string") continue;
        fieldsByCandidate.set(candidateId, [...(fieldsByCandidate.get(candidateId) ?? []), field]);
      }
      const canonicalByCandidate = new Map<string, RecordLike>();
      for (const raw of correctionRows) {
        const row = asRecord(raw);
        if (!row || typeof row.candidate_id !== "string" || typeof row.field_path !== "string" || typeof row.occurrence_key !== "string") continue;
        if (row.field_path === "$canonical_payload") {
          const payload = asRecord(row.new_value);
          if (payload) canonicalByCandidate.set(row.candidate_id, payload);
          continue;
        }
        const fields = fieldsByCandidate.get(row.candidate_id) ?? [];
        const field = fields.find((candidateField) => candidateField.fieldPath === row.field_path && candidateField.occurrenceKey === row.occurrence_key);
        if (field) field.value = row.new_value;
      }
      const confirmedItemByCandidate = new Map<string, string>();
      for (const raw of confirmationRows) {
        const row = asRecord(raw);
        if (typeof row?.candidate_id === "string" && typeof row.travel_item_id === "string") confirmedItemByCandidate.set(row.candidate_id, row.travel_item_id);
      }
      const warningsByCandidate = new Map<string, ExtractionWarning[]>();
      const warningsByRun = new Map<string, ExtractionWarning[]>();
      for (const row of warningRows) {
        const warning = mapWarning(row);
        if (!warning) continue;
        if (warning.candidateId) warningsByCandidate.set(warning.candidateId, [...(warningsByCandidate.get(warning.candidateId) ?? []), warning.warning]);
        else warningsByRun.set(warning.runId, [...(warningsByRun.get(warning.runId) ?? []), warning.warning]);
      }
      const candidatesByRun = new Map<string, ExtractionCandidate[]>();
      for (const row of candidateRows) {
        const candidateId = asRecord(row)?.id as string;
        const candidate = mapCandidate(row, fieldsByCandidate.get(candidateId) ?? [], warningsByCandidate.get(candidateId) ?? [], canonicalByCandidate.get(candidateId) ?? null, confirmedItemByCandidate.get(candidateId) ?? null);
        const runId = asRecord(row)?.extraction_run_id;
        if (!candidate || typeof runId !== "string") continue;
        candidatesByRun.set(runId, [...(candidatesByRun.get(runId) ?? []), candidate]);
      }
      const runs = runRows
        .map((row) => {
          const id = asRecord(row)?.id;
          return typeof id === "string" ? mapRun(row, candidatesByRun.get(id) ?? [], warningsByRun.get(id) ?? []) : null;
        })
        .filter((run): run is ExtractionRun => run !== null);
      return runs.length === runRows.length ? { kind: "ready", runs } : { kind: "unavailable" };
    },

    async startExtraction(input): Promise<ExtractionStartResult> {
      const { data, error } = await client.functions.invoke("start-document-extraction", {
        body: { document_id: input.documentId, idempotency_key: input.idempotencyKey }
      });
      const body = asRecord(data);
      const responseCode = error ? await readFunctionErrorCode(error) : undefined;
      const code = typeof body?.code === "string" ? body.code : responseCode;
      if (error || !body) {
        const message = error instanceof Error ? error.message : "";
        const extractedCode = code ?? message.match(/\b([a-z_]+)\b/)?.[1];
        if (extractedCode && ["extraction_limit", "extraction_parallel_limit", "budget_exhausted"].includes(extractedCode)) {
          return { kind: "limit", code: extractedCode, message: extractionErrorMessage(extractedCode) };
        }
        return { kind: "unavailable", code: extractedCode, message: extractionErrorMessage(extractedCode) };
      }
      const run = mapRun(body.run, [], []);
      if (!run) {
        if (code && ["extraction_limit", "extraction_parallel_limit", "budget_exhausted"].includes(code)) return { kind: "limit", code, message: extractionErrorMessage(code) };
        return { kind: "failed", code, message: extractionErrorMessage(code) };
      }
      return { kind: "accepted", run };
    },

    async saveCandidateReview(input): Promise<CandidateMutationResult> {
      const { data, error } = await client.rpc("apply_candidate_review", {
        p_candidate_id: input.candidateId,
        p_expected_version: input.expectedVersion,
        p_corrections: (input.corrections ?? []).map((correction) => ({
          field_path: correction.fieldPath,
          occurrence_key: correction.occurrenceKey,
          operation: correction.operation,
          new_value: correction.newValue
        })),
        p_canonical_payload: input.payload
      });
      return mapCandidateMutation(data, error);
    },

    async discardCandidate(input): Promise<CandidateMutationResult> {
      const { data, error } = await client.rpc("discard_candidate", {
        p_candidate_id: input.candidateId,
        p_expected_version: input.expectedVersion
      });
      return mapCandidateMutation(data, error);
    },

    async confirmCandidate(input): Promise<CandidateMutationResult> {
      const { data, error } = await client.rpc("confirm_candidate", {
        p_candidate_id: input.candidateId,
        p_expected_version: input.expectedVersion,
        p_idempotency_key: input.idempotencyKey,
        p_payload: input.payload
      });
      return mapCandidateMutation(data, error);
    },

    async downloadDocument(input: { tripId: string; documentId: string }): Promise<DocumentDownloadResult> {
      const document = await getDocument(input.tripId, input.documentId);
      if (!document || document.status !== "available") return { kind: "forbidden", message: documentErrorMessage("forbidden") };
      const { data, error } = await client.storage.from(DOCUMENT_BUCKET).download(document.storageObjectKey);
      if (error || !data) return { kind: "unavailable", message: "Das Original konnte nicht geladen werden. Bitte versuchen Sie es erneut." };
      return {
        kind: "downloaded",
        blob: data,
        fileName: document.originalFileName,
        contentType: document.detectedContentType ?? document.reportedContentType ?? "application/octet-stream"
      };
    },

    subscribeToDocuments({ tripId, onSignal, onStatus }) {
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
          .channel(`documents:${tripId}`)
          .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "documents", filter: `trip_id=eq.${tripId}` },
            () => onSignal()
          )
          .on("postgres_changes", { event: "*", schema: "public", table: "extraction_runs" }, () => onSignal())
          .on("postgres_changes", { event: "*", schema: "public", table: "extraction_candidates" }, () => onSignal())
          .on("postgres_changes", { event: "*", schema: "public", table: "candidate_corrections" }, () => onSignal())
          .on("postgres_changes", { event: "*", schema: "public", table: "candidate_confirmations" }, () => onSignal())
          .on("postgres_changes", { event: "*", schema: "public", table: "travel_item_documents" }, () => onSignal())
          .on("postgres_changes", { event: "*", schema: "public", table: "extraction_run_warnings" }, () => onSignal())
          .subscribe((status: string) => {
            const mappedStatus = mapRealtimeStatus(status);
            onStatus(mappedStatus);
            if (mappedStatus === "disconnected") scheduleReconnect();
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
