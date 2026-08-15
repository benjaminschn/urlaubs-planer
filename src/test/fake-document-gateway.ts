import { documentErrorMessage, validateDocumentBytes } from "../documents/validation";
import type {
  Document,
  DocumentGateway,
  DocumentRealtimeStatus,
  DocumentUploadInput,
  ExtractionRun
} from "../documents/types";

type StoredDocument = Document & { idempotencyKey: string; batchKey: string; contentBase64: string };
const storageKey = "gemeinsamer-reiseplaner-e2e-documents";
const channelName = "gemeinsamer-reiseplaner-e2e-documents-realtime";
const fallbackStorage = new Map<string, string>();

export function clearFakeDocumentStorage() {
  fallbackStorage.clear();
  const storage = window.localStorage as Partial<Storage>;
  if (typeof storage.removeItem === "function") storage.removeItem(storageKey);
}

function readRaw(): string | null {
  const storage = window.localStorage as Partial<Storage>;
  return typeof storage.getItem === "function" ? storage.getItem(storageKey) : fallbackStorage.get(storageKey) ?? null;
}

function writeRaw(value: string) {
  const storage = window.localStorage as Partial<Storage>;
  if (typeof storage.setItem === "function") storage.setItem(storageKey, value);
  else fallbackStorage.set(storageKey, value);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function readDocuments(): StoredDocument[] {
  const raw = readRaw();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as StoredDocument[]) : [];
  } catch {
    return [];
  }
}

function writeDocuments(documents: StoredDocument[]) {
  writeRaw(JSON.stringify(documents));
  const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(channelName);
  channel?.postMessage({ type: "documents-updated" });
  channel?.close();
}

async function checksum(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as BufferSource);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function newId(counter: number): string {
  return `44444444-4444-4444-8444-${String(counter).padStart(12, "0")}`;
}

export function createFakeDocumentGateway(options: { tripId?: string; documents?: Document[] } = {}) {
  const tripId = options.tripId ?? "22222222-2222-4222-8222-222222222222";
  let counter = 1;
  let activeUploads = 0;
  let extractionCounter = 1;
  let extractionRuns: ExtractionRun[] = [];
  const listeners = new Set<() => void>();
  const statusListeners = new Set<(status: DocumentRealtimeStatus) => void>();
  const calls = { list: 0, upload: 0, download: 0, subscribe: 0 };
  if (options.documents && options.documents.length > 0) {
    writeDocuments(options.documents.map((document) => ({ ...document, idempotencyKey: `seed-${document.id}`, batchKey: "seed", contentBase64: "" })));
  }

  function signal() {
    for (const listener of listeners) listener();
  }

  const gateway: DocumentGateway = {
    async listDocuments(requestTripId) {
      calls.list += 1;
      if (requestTripId !== tripId) return { kind: "ready", documents: [] };
      return { kind: "ready", documents: readDocuments().filter((document) => document.status !== "deleted") };
    },
    async uploadDocument(input: DocumentUploadInput) {
      calls.upload += 1;
      const documents = readDocuments();
      const replay = documents.find((document) => document.tripId === input.tripId && document.idempotencyKey === input.idempotencyKey);
      if (replay) {
        return replay.status === "available"
          ? { kind: "available", document: replay }
          : { kind: "failed", document: replay, message: documentErrorMessage(replay.errorCode), code: replay.errorCode ?? undefined };
      }
      if (input.batchFileCount > 5) return { kind: "limit", message: documentErrorMessage("selection_too_many"), code: "selection_too_many" };
      if (input.batchTotalBytes > 50 * 1024 * 1024) return { kind: "limit", message: documentErrorMessage("selection_too_large"), code: "selection_too_large" };
      if (input.file.size > 20 * 1024 * 1024) return { kind: "limit", message: documentErrorMessage("file_too_large"), code: "file_too_large" };
      if (documents.filter((document) => document.tripId === input.tripId && document.status !== "deleted").length >= 50) {
        return { kind: "limit", message: documentErrorMessage("document_limit"), code: "document_limit" };
      }
      if (activeUploads >= 2) return { kind: "limit", message: documentErrorMessage("parallel_limit"), code: "parallel_limit" };
      activeUploads += 1;
      try {
        const bytes = new Uint8Array(await input.file.arrayBuffer());
        const validation = validateDocumentBytes(bytes, input.file.name, input.file.type || null);
        const now = new Date().toISOString();
        const id = newId(counter++);
        const baseDocument: StoredDocument = {
          id,
          tripId: input.tripId,
          uploadedByUserId: "member@example.test",
          originalFileName: input.file.name,
          reportedContentType: input.file.type || null,
          detectedContentType: validation.kind === "valid" ? validation.detectedContentType : null,
          byteSize: input.file.size,
          checksum: validation.kind === "valid" ? await checksum(bytes) : null,
          storageObjectKey: `quarantine/${id}`,
          status: validation.kind === "valid" ? "available" : "invalid",
          errorCode: validation.kind === "valid" ? null : validation.code,
          version: 2,
          createdAt: now,
          updatedAt: now,
          uploadedAt: validation.kind === "valid" ? now : null,
          idempotencyKey: input.idempotencyKey,
          batchKey: input.batchKey,
          contentBase64: bytesToBase64(bytes)
        };
        const updated = [...documents, baseDocument];
        writeDocuments(updated);
        signal();
        return validation.kind === "valid"
          ? { kind: "available", document: baseDocument }
          : { kind: "failed", document: baseDocument, message: documentErrorMessage(validation.code), code: validation.code };
      } finally {
        activeUploads = Math.max(0, activeUploads - 1);
      }
    },
    async retryVerification(input) {
      const documents = readDocuments();
      const document = documents.find((candidate) => candidate.id === input.documentId && candidate.tripId === input.tripId);
      if (!document || (document.status !== "verification_pending" && document.status !== "verifying")) {
        return { kind: "unavailable", message: documentErrorMessage("verification_unavailable") };
      }
      const available = { ...document, status: "available" as const, errorCode: null, uploadedAt: new Date().toISOString(), version: document.version + 1 };
      writeDocuments(documents.map((candidate) => candidate.id === available.id ? available : candidate));
      signal();
      return { kind: "available", document: available };
    },
    async downloadDocument(input) {
      calls.download += 1;
      const document = readDocuments().find((candidate) => candidate.id === input.documentId && candidate.tripId === input.tripId);
      if (!document || document.status !== "available") return { kind: "forbidden", message: documentErrorMessage("forbidden") };
      return {
        kind: "downloaded",
        blob: new Blob([base64ToBytes(document.contentBase64) as unknown as ArrayBuffer], { type: document.detectedContentType ?? "application/octet-stream" }),
        fileName: document.originalFileName,
        contentType: document.detectedContentType ?? "application/octet-stream"
      };
    },
    async listExtractions(requestTripId) {
      return { kind: "ready", runs: requestTripId === tripId ? extractionRuns : [] };
    },
    async startExtraction(input) {
      const document = readDocuments().find((candidate) => candidate.id === input.documentId && candidate.tripId === tripId && candidate.status === "available");
      if (!document) return { kind: "failed", code: "forbidden", message: documentErrorMessage("forbidden") };
      const active = extractionRuns.find((run) => run.documentId === input.documentId && ["queued", "processing"].includes(run.status));
      if (active) return { kind: "accepted", run: active };
      const now = new Date().toISOString();
      const run: ExtractionRun = {
        id: `55555555-5555-4555-8555-${String(extractionCounter++).padStart(12, "0")}`,
        documentId: input.documentId,
        status: "succeeded",
        errorCode: null,
        providerAttemptCount: 1,
        createdAt: now,
        updatedAt: now,
        completedAt: now,
        warnings: [],
        candidates: [{
          id: `66666666-6666-4666-8666-${String(extractionCounter).padStart(12, "0")}`,
          candidateIndex: 0,
          proposedEventTypeCode: "accommodation",
          status: "draft",
          version: 1,
          canonicalPayload: null,
          confirmedTravelItemId: null,
          fields: [
            { fieldPath: "title", occurrenceKey: "", originalValue: "Erkannte Unterkunft", value: "Erkannte Unterkunft", provenance: "explicit", confidence: 0.95, sourceLocator: [{ pageNumber: 1, sourceHint: "Beispielbestätigung" }] },
            { fieldPath: "start.local_date", occurrenceKey: "", originalValue: "2026-09-01", value: "2026-09-01", provenance: "explicit", confidence: 0.95, sourceLocator: [{ pageNumber: 1, sourceHint: "Anreise" }] }
          ],
          warnings: []
        }]
      };
      extractionRuns = [run, ...extractionRuns];
      signal();
      return { kind: "accepted", run };
    },
    async saveCandidateReview(input) {
      let updated = false;
      extractionRuns = extractionRuns.map((run) => ({ ...run, candidates: run.candidates.map((candidate) => {
        if (candidate.id !== input.candidateId || candidate.version !== input.expectedVersion || candidate.status !== "draft") return candidate;
        updated = true;
        return { ...candidate, canonicalPayload: input.payload, version: candidate.version + (input.corrections?.length ?? 0) + 1 };
      }) }));
      signal();
      return updated
        ? { kind: "updated", candidateId: input.candidateId, version: input.expectedVersion + (input.corrections?.length ?? 0) + 1 }
        : { kind: "conflict", candidateId: input.candidateId, version: input.expectedVersion, message: "Der Entwurf wurde zwischenzeitlich geändert." };
    },
    async discardCandidate(input) {
      let updated = false;
      extractionRuns = extractionRuns.map((run) => ({ ...run, candidates: run.candidates.map((candidate) => {
        if (candidate.id !== input.candidateId || candidate.version !== input.expectedVersion || candidate.status !== "draft") return candidate;
        updated = true;
        return { ...candidate, status: "discarded", version: candidate.version + 1 };
      }) }));
      signal();
      return updated
        ? { kind: "discarded", candidateId: input.candidateId, version: input.expectedVersion + 1 }
        : { kind: "forbidden", message: "Der Entwurf ist nicht verfügbar." };
    },
    async confirmCandidate(input) {
      const candidate = extractionRuns.flatMap((run) => run.candidates).find((item) => item.id === input.candidateId);
      if (!candidate || candidate.status !== "draft") return { kind: "forbidden", message: "Der Entwurf ist nicht verfügbar." };
      if (candidate.version !== input.expectedVersion) return { kind: "conflict", candidateId: input.candidateId, version: candidate.version, message: "Der Entwurf wurde zwischenzeitlich geändert." };
      if (!candidate.canonicalPayload || JSON.stringify(candidate.canonicalPayload) !== JSON.stringify(input.payload)) return { kind: "validation", message: "Der geprüfte Stand muss gespeichert werden." };
      extractionRuns = extractionRuns.map((run) => ({ ...run, candidates: run.candidates.map((item) => item.id === input.candidateId ? { ...item, status: "confirmed", version: item.version + 1, confirmedTravelItemId: "77777777-7777-4777-8777-777777777777" } : item) }));
      signal();
      return { kind: "created", candidateId: input.candidateId, travelItemId: "77777777-7777-4777-8777-777777777777", version: 1 };
    },
    subscribeToDocuments({ onSignal, onStatus }) {
      calls.subscribe += 1;
      listeners.add(onSignal);
      statusListeners.add(onStatus);
      onStatus("connected");
      return () => {
        listeners.delete(onSignal);
        statusListeners.delete(onStatus);
      };
    }
  };

  function seedDocument(document: Partial<Document> & Pick<Document, "id" | "status">) {
    const now = new Date().toISOString();
    const stored: StoredDocument = {
      id: document.id,
      tripId: document.tripId ?? tripId,
      uploadedByUserId: document.uploadedByUserId ?? "member@example.test",
      originalFileName: document.originalFileName ?? "dokument.pdf",
      reportedContentType: document.reportedContentType ?? "application/pdf",
      detectedContentType: document.detectedContentType ?? null,
      byteSize: document.byteSize ?? 1024,
      checksum: document.checksum ?? null,
      storageObjectKey: document.storageObjectKey ?? `quarantine/${document.id}`,
      status: document.status,
      errorCode: document.errorCode ?? null,
      version: document.version ?? 1,
      createdAt: document.createdAt ?? now,
      updatedAt: document.updatedAt ?? now,
      uploadedAt: document.uploadedAt ?? null,
      idempotencyKey: `seed-${document.id}`,
      batchKey: "seed",
      contentBase64: ""
    };
    writeDocuments([...readDocuments().filter((existing) => existing.id !== stored.id), stored]);
    signal();
    return stored;
  }

  return {
    gateway,
    calls,
    seedDocument,
    getDocuments: () => readDocuments(),
    getExtractionRuns: () => extractionRuns,
    mutateCandidateExternally(candidateId: string, payload: Record<string, unknown>) {
      extractionRuns = extractionRuns.map((run) => ({
        ...run,
        candidates: run.candidates.map((candidate) => candidate.id === candidateId
          ? { ...candidate, canonicalPayload: payload, version: candidate.version + 1 }
          : candidate)
      }));
      signal();
    },
    emitSignal: () => signal(),
    setRealtimeStatus: (status: DocumentRealtimeStatus) => {
      for (const listener of statusListeners) listener(status);
    },
    mutateExternally: (documentId: string, status: Document["status"]) => {
      const documents = readDocuments().map((document) => document.id === documentId ? { ...document, status, version: document.version + 1 } : document);
      writeDocuments(documents);
    }
  };
}
