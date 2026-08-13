export const DOCUMENT_BUCKET = "travel-documents";
export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;
export const MAX_SELECTION_BYTES = 50 * 1024 * 1024;
export const MAX_SELECTION_FILES = 5;
export const MAX_TRIP_DOCUMENTS = 50;

export const DOCUMENT_STATUSES = [
  "uploading",
  "uploaded",
  "verifying",
  "verification_pending",
  "available",
  "upload_failed",
  "unsupported",
  "invalid",
  "deleted"
] as const;

export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export type Document = {
  id: string;
  tripId: string;
  uploadedByUserId: string;
  originalFileName: string;
  reportedContentType: string | null;
  detectedContentType: string | null;
  byteSize: number;
  checksum: string | null;
  storageObjectKey: string;
  status: DocumentStatus;
  errorCode: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  uploadedAt: string | null;
};

export type DocumentLoadResult =
  | { kind: "ready"; documents: Document[] }
  | { kind: "unavailable" };

export type DocumentUploadInput = {
  tripId: string;
  file: File;
  idempotencyKey: string;
  batchKey: string;
  batchFileCount: number;
  batchTotalBytes: number;
};

export type DocumentUploadResult =
  | { kind: "available"; document: Document }
  | { kind: "failed"; document?: Document; message: string; code?: string }
  | { kind: "limit"; message: string; code?: string }
  | { kind: "validation"; message: string; code?: string }
  | { kind: "unavailable"; message: string };

export type DocumentDownloadResult =
  | { kind: "downloaded"; blob: Blob; fileName: string; contentType: string }
  | { kind: "forbidden"; message: string }
  | { kind: "unavailable"; message: string };

export type DocumentRealtimeStatus = "connecting" | "connected" | "disconnected";

export const EXTRACTION_RUN_STATUSES = [
  "queued",
  "processing",
  "succeeded",
  "failed_retryable",
  "failed_terminal",
  "expired"
] as const;

export type ExtractionRunStatus = (typeof EXTRACTION_RUN_STATUSES)[number];

export type ExtractionField = {
  fieldPath: string;
  occurrenceKey: string;
  originalValue: unknown;
  value: unknown;
  provenance: "explicit" | "inferred" | "unknown";
  confidence: number | null;
  sourceLocator: { pageNumber: number | null; sourceHint: string }[];
};

export type ExtractionWarning = {
  code: string;
  severity: "info" | "review" | "blocking";
  fieldPath: string | null;
  message: string;
};

export type ExtractionCandidate = {
  id: string;
  candidateIndex: number;
  proposedEventTypeCode: "accommodation" | "flight" | "rail" | "bus" | "activity";
  status: "draft" | "confirmed" | "discarded" | "superseded";
  version: number;
  canonicalPayload: Record<string, unknown> | null;
  confirmedTravelItemId: string | null;
  fields: ExtractionField[];
  warnings: ExtractionWarning[];
};

export type ExtractionRun = {
  id: string;
  documentId: string;
  status: ExtractionRunStatus;
  errorCode: string | null;
  providerAttemptCount: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  candidates: ExtractionCandidate[];
  warnings: ExtractionWarning[];
};

export type ExtractionLoadResult =
  | { kind: "ready"; runs: ExtractionRun[] }
  | { kind: "unavailable" };

export type ExtractionStartResult =
  | { kind: "accepted"; run: ExtractionRun }
  | { kind: "limit" | "failed" | "unavailable"; message: string; code?: string };

export type CandidateMutationResult =
  | { kind: "updated" | "discarded"; candidateId: string; version: number }
  | { kind: "created" | "replayed"; candidateId: string; travelItemId: string; version: number }
  | { kind: "conflict"; candidateId: string; version: number; message: string }
  | { kind: "validation" | "limit" | "forbidden" | "unavailable"; message: string; code?: string };

export type CandidateCorrectionInput = {
  fieldPath: string;
  occurrenceKey: string;
  operation: "set" | "remove" | "add_occurrence" | "remove_occurrence" | "reorder";
  newValue: unknown;
};

export type DocumentGateway = {
  listDocuments: (tripId: string) => Promise<DocumentLoadResult>;
  uploadDocument: (input: DocumentUploadInput) => Promise<DocumentUploadResult>;
  retryVerification: (input: { tripId: string; documentId: string }) => Promise<DocumentUploadResult>;
  downloadDocument: (input: { tripId: string; documentId: string }) => Promise<DocumentDownloadResult>;
  listExtractions: (tripId: string) => Promise<ExtractionLoadResult>;
  startExtraction: (input: { documentId: string; idempotencyKey: string }) => Promise<ExtractionStartResult>;
  saveCandidateReview: (input: {
    candidateId: string;
    expectedVersion: number;
    payload: Record<string, unknown>;
    corrections?: CandidateCorrectionInput[];
  }) => Promise<CandidateMutationResult>;
  discardCandidate: (input: { candidateId: string; expectedVersion: number }) => Promise<CandidateMutationResult>;
  confirmCandidate: (input: { candidateId: string; expectedVersion: number; idempotencyKey: string; payload: Record<string, unknown> }) => Promise<CandidateMutationResult>;
  subscribeToDocuments: (options: {
    tripId: string;
    onSignal: () => void;
    onStatus: (status: DocumentRealtimeStatus) => void;
  }) => () => void;
};
