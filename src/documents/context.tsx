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
  Document,
  DocumentDownloadResult,
  DocumentGateway,
  DocumentRealtimeStatus,
  ExtractionRun,
  ExtractionStartResult,
  DocumentUploadInput,
  DocumentUploadResult
} from "./types";
import { documentErrorMessage } from "./validation";

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
  download: (documentId: string) => Promise<DocumentDownloadResult>;
  startExtraction: (documentId: string) => Promise<ExtractionStartResult>;
};

const DocumentContext = createContext<DocumentContextValue | null>(null);
const loadErrorMessage = "Die Dokumente konnten nicht geladen werden. Bitte versuchen Sie es erneut.";

type ProviderProps = PropsWithChildren<{ gateway: DocumentGateway | null }>;

export function DocumentProvider({ children, gateway }: ProviderProps) {
  const { state: authState } = useAuth();
  const { state: tripState } = useTrip();
  const [state, setState] = useState<DocumentState>({ status: "idle", documents: [], runs: [] });
  const [realtimeStatus, setRealtimeStatus] = useState<DocumentRealtimeStatus>("connecting");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [activeUploads, setActiveUploads] = useState(0);
  const requestNumber = useRef(0);
  const stateRef = useRef(state);
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
      setState({ status: "ready", documents: result.documents, runs: extractionResult.runs });
      return result.documents;
    }
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
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [reload, state.status]);

  const upload = useCallback(
    async (input: Omit<DocumentUploadInput, "tripId">): Promise<DocumentUploadResult> => {
      if (!gateway || !trip || (stateRef.current.status !== "ready" && stateRef.current.status !== "error")) {
        return { kind: "unavailable", message: documentErrorMessage("unknown") };
      }
      setActiveUploads((count) => count + 1);
      try {
        const result = await gateway.uploadDocument({ ...input, tripId: trip.id });
        if (result.kind === "available" || result.kind === "failed") {
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
      if (!gateway || !trip) return Promise.resolve({ kind: "unavailable", message: documentErrorMessage("unknown") } satisfies DocumentDownloadResult);
      return gateway.downloadDocument({ tripId: trip.id, documentId });
    },
    [gateway, trip]
  );

  const startExtraction = useCallback(
    async (documentId: string): Promise<ExtractionStartResult> => {
      if (!gateway || !trip) return { kind: "unavailable", message: "Die Verarbeitung ist derzeit nicht verfügbar." };
      const result = await gateway.startExtraction({ documentId, idempotencyKey: crypto.randomUUID() });
      if (result.kind === "accepted") {
        setState((current) => ({
          status: "ready",
          documents: current.documents,
          runs: [result.run, ...current.runs.filter((run) => run.id !== result.run.id)],
          message: undefined
        }));
        await reload();
      }
      return result;
    },
    [gateway, reload, trip]
  );

  const value = useMemo<DocumentContextValue>(
    () => ({ state, realtimeStatus, isRefreshing, isUploading: activeUploads > 0, reload, upload, download, startExtraction }),
    [activeUploads, download, isRefreshing, realtimeStatus, reload, startExtraction, state, upload]
  );
  return <DocumentContext.Provider value={value}>{children}</DocumentContext.Provider>;
}

export function useDocuments(): DocumentContextValue {
  const value = useContext(DocumentContext);
  if (!value) throw new Error("useDocuments muss innerhalb von DocumentProvider verwendet werden.");
  return value;
}
