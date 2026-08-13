import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren
} from "react";
import { useAuth } from "../auth/context";
import { useTrip } from "../trip/context";
import type {
  CandidateMutationResult,
  CandidateCorrectionInput,
  Document,
  DocumentDownloadResult,
  DocumentGateway,
  DocumentRealtimeStatus,
  ExtractionRun,
  ExtractionStartResult,
  DocumentUploadInput,
  DocumentUploadResult,
  ExtractionCandidate
} from "./types";
import { documentErrorMessage } from "./validation";
import { isNetworkAvailable, offlineActionMessage } from "../pwa/network";
import { useOptionalPwa } from "../pwa/context";

export type DocumentState =
  | { status: "idle" | "loading" | "disabled"; documents: Document[]; runs: ExtractionRun[]; message?: string }
  | { status: "error"; documents: Document[]; runs: ExtractionRun[]; message: string }
  | { status: "ready"; documents: Document[]; runs: ExtractionRun[]; message?: string };

type DocumentContextValue = {
  state: DocumentState;
  realtimeStatus: DocumentRealtimeStatus;
  isRefreshing: boolean;
  isUploading: boolean;
  reload: () => Promise<Document[]>;
  upload: (input: Omit<DocumentUploadInput, "tripId">) => Promise<DocumentUploadResult>;
  retryVerification: (documentId: string) => Promise<DocumentUploadResult>;
  download: (documentId: string) => Promise<DocumentDownloadResult>;
  startExtraction: (documentId: string) => Promise<ExtractionStartResult>;
  getCandidate: (candidateId: string) => { candidate: ExtractionCandidate; document: Document } | null;
  saveCandidateReview: (
    candidateId: string,
    expectedVersion: number,
    payload: Record<string, unknown>,
    corrections?: CandidateCorrectionInput[]
  ) => Promise<CandidateMutationResult>;
  discardCandidate: (candidateId: string, expectedVersion: number) => Promise<CandidateMutationResult>;
  confirmCandidate: (candidateId: string, expectedVersion: number, payload: Record<string, unknown>, idempotencyKey: string) => Promise<CandidateMutationResult>;
};

const DocumentContext = createContext<DocumentContextValue | null>(null);
const loadErrorMessage = "Die Dokumente konnten nicht geladen werden. Bitte versuchen Sie es erneut.";

type ProviderProps = PropsWithChildren<{ gateway: DocumentGateway | null }>;

export function DocumentProvider({ children, gateway }: ProviderProps) {
  const { state: authState } = useAuth();
  const pwa = useOptionalPwa();
  const { state: tripState } = useTrip();
  const [state, setState] = useState<DocumentState>({ status: "idle", documents: [], runs: [] });
  const [realtimeStatus, setRealtimeStatus] = useState<DocumentRealtimeStatus>("connecting");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [activeUploads, setActiveUploads] = useState(0);
  const requestNumber = useRef(0);
  const stateRef = useRef(state);
  const lastReloadSucceeded = useRef(false);
  stateRef.current = state;
  const activeUserId = authState.status === "authenticated" ? authState.user.id : null;
  const trip = tripState.status === "ready" ? tripState.trip : null;

  const reload = useCallback(async (): Promise<Document[]> => {
    if (!activeUserId || !trip || !gateway) return [];
    const request = ++requestNumber.current;
    const currentState = stateRef.current;
    if (currentState.status === "ready" || currentState.status === "error") setIsRefreshing(true);
    else setState({ status: "loading", documents: [], runs: [] });
    const [result, extractionResult] = await Promise.all([gateway.listDocuments(trip.id), gateway.listExtractions(trip.id)]);
    if (request !== requestNumber.current) return [];
    setIsRefreshing(false);
    if (result.kind === "ready" && extractionResult.kind === "ready") {
      lastReloadSucceeded.current = true;
      setState({ status: "ready", documents: result.documents, runs: extractionResult.runs });
      return result.documents;
    }
    lastReloadSucceeded.current = false;
    if (currentState.status === "ready" || currentState.status === "error") {
      setState({ status: "ready", documents: currentState.documents, runs: currentState.runs, message: loadErrorMessage });
      return currentState.documents;
    }
    setState({ status: "error", documents: [], runs: [], message: loadErrorMessage });
    return [];
  }, [activeUserId, gateway, trip]);

  useEffect(() => {
    requestNumber.current += 1;
    setRealtimeStatus("connecting");
    setIsRefreshing(false);
    setActiveUploads(0);
    if (!activeUserId || !trip) {
      setState({ status: "idle", documents: [], runs: [] });
      return;
    }
    if (!gateway) {
      setState({ status: "disabled", documents: [], runs: [] });
      return;
    }
    void reload();
  }, [activeUserId, gateway, reload, trip]);

  useEffect(() => {
    if ((state.status !== "ready" && state.status !== "error") || !gateway || !trip) return;
    return gateway.subscribeToDocuments({ tripId: trip.id, onSignal: () => void reload(), onStatus: setRealtimeStatus });
  }, [gateway, reload, state.status, trip]);

  useEffect(() => {
    if (state.status !== "ready" && state.status !== "error") return;
    const refresh = () => void reload();
    const onVisibility = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [reload, state.status]);

  useEffect(() => pwa?.registerResync("documents", async () => {
    await reload();
    return lastReloadSucceeded.current;
  }), [pwa, reload]);

  const upload = useCallback(
    async (input: Omit<DocumentUploadInput, "tripId">): Promise<DocumentUploadResult> => {
      if (!isNetworkAvailable()) {
        return { kind: "unavailable", message: offlineActionMessage };
      }
      if (!gateway || !trip || (stateRef.current.status !== "ready" && stateRef.current.status !== "error")) {
        return { kind: "unavailable", message: documentErrorMessage("unknown") };
      }
      setActiveUploads((count) => count + 1);
      try {
        const result = await gateway.uploadDocument({ ...input, tripId: trip.id });
        if (result.kind === "available" || result.kind === "failed") {
          requestNumber.current += 1;
          setIsRefreshing(false);
          setState((current) => {
            const document = result.document;
            if (!document) return result.kind === "failed" ? { ...current, message: result.message } : current;
            const documents = [document, ...current.documents.filter((item) => item.id !== document.id)];
            return result.kind === "failed"
              ? { status: "ready", documents, runs: current.runs, message: result.message }
              : { status: "ready", documents, runs: current.runs };
          });
        }
        return result;
      } catch {
        return { kind: "unavailable", message: documentErrorMessage("unknown") };
      } finally {
        setActiveUploads((count) => Math.max(0, count - 1));
      }
    },
    [gateway, trip]
  );

  const download = useCallback(
    (documentId: string) => {
      if (!isNetworkAvailable()) {
        return Promise.resolve({ kind: "unavailable", message: offlineActionMessage } satisfies DocumentDownloadResult);
      }
      if (!gateway || !trip) return Promise.resolve({ kind: "unavailable", message: documentErrorMessage("unknown") } satisfies DocumentDownloadResult);
      return gateway.downloadDocument({ tripId: trip.id, documentId });
    },
    [gateway, trip]
  );

  const retryVerification = useCallback(async (documentId: string): Promise<DocumentUploadResult> => {
    if (!isNetworkAvailable()) return { kind: "unavailable", message: offlineActionMessage };
    if (!gateway || !trip) return { kind: "unavailable", message: documentErrorMessage("verification_unavailable") };
    const result = await gateway.retryVerification({ tripId: trip.id, documentId });
    await reload();
    return result;
  }, [gateway, reload, trip]);

  const startExtraction = useCallback(
    async (documentId: string): Promise<ExtractionStartResult> => {
      if (!isNetworkAvailable()) return { kind: "unavailable", message: offlineActionMessage };
      if (!gateway || !trip) return { kind: "unavailable", message: "Die Verarbeitung ist derzeit nicht verfügbar." };
      const result = await gateway.startExtraction({ documentId, idempotencyKey: crypto.randomUUID() });
      if (result.kind === "accepted") {
        setState((current) => ({
          status: "ready",
          documents: current.documents,
          runs: [result.run, ...current.runs.filter((run) => run.id !== result.run.id)],
          message: undefined
        }));
      }
      // Always re-sync from the server so terminal failures after realtime "processing" are not stuck.
      await reload();
      return result;
    },
    [gateway, reload, trip]
  );

  const getCandidate = useCallback((candidateId: string) => {
    for (const run of state.runs) {
      const candidate = run.candidates.find((item) => item.id === candidateId);
      const document = candidate ? state.documents.find((item) => item.id === run.documentId) : null;
      if (candidate && document) return { candidate, document };
    }
    return null;
  }, [state.documents, state.runs]);

  const saveCandidateReview = useCallback(async (candidateId: string, expectedVersion: number, payload: Record<string, unknown>, corrections?: CandidateCorrectionInput[]) => {
    if (!isNetworkAvailable()) return { kind: "unavailable", message: offlineActionMessage } satisfies CandidateMutationResult;
    if (!gateway) return { kind: "unavailable", message: "Der Entwurf konnte nicht gespeichert werden." } satisfies CandidateMutationResult;
    const result = await gateway.saveCandidateReview({ candidateId, expectedVersion, payload, corrections });
    await reload();
    return result;
  }, [gateway, reload]);

  const discardCandidate = useCallback(async (candidateId: string, expectedVersion: number) => {
    if (!isNetworkAvailable()) return { kind: "unavailable", message: offlineActionMessage } satisfies CandidateMutationResult;
    if (!gateway) return { kind: "unavailable", message: "Der Entwurf konnte nicht verworfen werden." } satisfies CandidateMutationResult;
    const result = await gateway.discardCandidate({ candidateId, expectedVersion });
    await reload();
    return result;
  }, [gateway, reload]);

  const confirmCandidate = useCallback(async (candidateId: string, expectedVersion: number, payload: Record<string, unknown>, idempotencyKey: string) => {
    if (!isNetworkAvailable()) return { kind: "unavailable", message: offlineActionMessage } satisfies CandidateMutationResult;
    if (!gateway) return { kind: "unavailable", message: "Der Speicherstatus konnte nicht bestätigt werden." } satisfies CandidateMutationResult;
    const result = await gateway.confirmCandidate({ candidateId, expectedVersion, payload, idempotencyKey });
    await reload();
    return result;
  }, [gateway, reload]);

  const value = useMemo<DocumentContextValue>(
    () => ({ state, realtimeStatus, isRefreshing, isUploading: activeUploads > 0, reload, upload, retryVerification, download, startExtraction, getCandidate, saveCandidateReview, discardCandidate, confirmCandidate }),
    [activeUploads, confirmCandidate, discardCandidate, download, getCandidate, isRefreshing, realtimeStatus, reload, retryVerification, saveCandidateReview, startExtraction, state, upload]
  );
  return <DocumentContext.Provider value={value}>{children}</DocumentContext.Provider>;
}

export function useDocuments(): DocumentContextValue {
  const value = useContext(DocumentContext);
  if (!value) throw new Error("useDocuments muss innerhalb von DocumentProvider verwendet werden.");
  return value;
}
