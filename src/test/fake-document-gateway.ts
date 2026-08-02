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
          fields: [
            { fieldPath: "title", occurrenceKey: "", value: "Erkannte Unterkunft", provenance: "explicit", confidence: 0.95, sourceLocator: [{ pageNumber: 1, sourceHint: "Beispielbestätigung" }] },
            { fieldPath: "start.local_date", occurrenceKey: "", value: "2026-09-01", provenance: "explicit", confidence: 0.95, sourceLocator: [{ pageNumber: 1, sourceHint: "Anreise" }] }
          ],
          warnings: []
        }]
      };
      extractionRuns = [run, ...extractionRuns];
      signal();
      return { kind: "accepted", run };
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

  return {
    gateway,
    calls,
    getDocuments: () => readDocuments(),
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
