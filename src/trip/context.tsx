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
import type {
  Trip,
  TripGateway,
  TripRealtimeStatus,
  TripUpdateInput,
  TripUpdateResult
} from "./types";

export type TripState =
  | { status: "idle"; trip: null }
  | { status: "loading"; trip: null }
  | { status: "configuration_error"; trip: null; message: string }
  | { status: "error"; trip: null; message: string }
  | { status: "ready"; trip: Trip; message?: string };

type TripContextValue = {
  state: TripState;
  realtimeStatus: TripRealtimeStatus;
  isRefreshing: boolean;
  isSaving: boolean;
  reload: () => Promise<Trip | null>;
  updateTrip: (
    input: Omit<TripUpdateInput, "tripId" | "expectedVersion"> & { expectedVersion?: number }
  ) => Promise<TripUpdateResult>;
};

const TripContext = createContext<TripContextValue | null>(null);

const configurationMessage = "Die gemeinsame Reise ist derzeit nicht verfügbar.";
const loadErrorMessage = "Die gemeinsame Reise konnte nicht geladen werden. Bitte versuchen Sie es erneut.";
const conflictMessage = "Die Reise wurde zwischenzeitlich geändert. Der neue Stand wurde geladen.";
const saveErrorMessage = "Die Reise konnte nicht gespeichert werden. Ihre Eingaben bleiben erhalten.";

type TripProviderProps = PropsWithChildren<{ gateway: TripGateway | null }>;

export function TripProvider({ children, gateway }: TripProviderProps) {
  const { state: authState } = useAuth();
  const [state, setState] = useState<TripState>({ status: "idle", trip: null });
  const [realtimeStatus, setRealtimeStatus] = useState<TripRealtimeStatus>("connecting");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const requestNumber = useRef(0);
  const stateRef = useRef(state);
  const isSavingRef = useRef(false);
  stateRef.current = state;
  const activeUserId = authState.status === "authenticated" ? authState.user.id : null;

  const reload = useCallback(async (): Promise<Trip | null> => {
    if (!gateway || !activeUserId) {
      return null;
    }

    const request = ++requestNumber.current;
    const currentState = stateRef.current;
    const hasReadyTrip = currentState.status === "ready";
    if (hasReadyTrip) {
      setIsRefreshing(true);
    } else {
      setState({ status: "loading", trip: null });
    }

    const result = await gateway.getActiveTrip();
    if (request !== requestNumber.current) {
      return null;
    }

    setIsRefreshing(false);
    if (result.kind === "ready") {
      setState({ status: "ready", trip: result.trip });
      return result.trip;
    }
    if (result.kind === "missing") {
      setState({ status: "configuration_error", trip: null, message: configurationMessage });
      return null;
    }
    if (hasReadyTrip && currentState.status === "ready") {
      setState({ ...currentState, message: loadErrorMessage });
      return null;
    }
    setState({ status: "error", trip: null, message: loadErrorMessage });
    return null;
  }, [activeUserId, gateway]);

  useEffect(() => {
    requestNumber.current += 1;
    setRealtimeStatus("connecting");
    setIsRefreshing(false);
    if (!activeUserId) {
      setState({ status: "idle", trip: null });
      return;
    }
    if (!gateway) {
      setState({ status: "configuration_error", trip: null, message: configurationMessage });
      return;
    }
    void reload();
  }, [activeUserId, gateway, reload]);

  useEffect(() => {
    if (state.status !== "ready" || !gateway) {
      return;
    }
    return gateway.subscribeToTrip({
      tripId: state.trip.id,
      onSignal: () => {
        void reload();
      },
      onStatus: setRealtimeStatus
    });
  }, [gateway, reload, state]);

  useEffect(() => {
    if (state.status !== "ready") {
      return;
    }
    const refresh = () => {
      void reload();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refresh();
      }
    };
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [reload, state.status]);

  const updateTrip = useCallback(
    async (
      input: Omit<TripUpdateInput, "tripId" | "expectedVersion"> & { expectedVersion?: number }
    ): Promise<TripUpdateResult> => {
      if (isSavingRef.current || !gateway || stateRef.current.status !== "ready") {
        return { kind: "unavailable" };
      }
      const currentTrip = stateRef.current.trip;
      isSavingRef.current = true;
      setIsSaving(true);
      try {
        const result = await gateway.updateTrip({
          ...input,
          tripId: currentTrip.id,
          expectedVersion: input.expectedVersion ?? currentTrip.version
        });
        if (result.kind === "updated") {
          setState({ status: "ready", trip: result.trip });
        } else if (result.kind === "conflict") {
          const freshTrip = await reload();
          setState((currentState) =>
            currentState.status === "ready" ? { ...currentState, message: conflictMessage } : currentState
          );
          if (freshTrip) {
            return { kind: "conflict", trip: freshTrip };
          }
        } else {
          setState({ status: "ready", trip: currentTrip, message: saveErrorMessage });
        }
        return result;
      } catch {
        setState({ status: "ready", trip: currentTrip, message: saveErrorMessage });
        return { kind: "unavailable" };
      } finally {
        isSavingRef.current = false;
        setIsSaving(false);
      }
    },
    [gateway, reload]
  );

  const value = useMemo<TripContextValue>(
    () => ({
      state,
      realtimeStatus,
      isRefreshing,
      isSaving,
      reload,
      updateTrip
    }),
    [isRefreshing, isSaving, realtimeStatus, reload, state, updateTrip]
  );

  return <TripContext.Provider value={value}>{children}</TripContext.Provider>;
}

export function useTrip(): TripContextValue {
  const value = useContext(TripContext);
  if (!value) {
    throw new Error("useTrip muss innerhalb von TripProvider verwendet werden.");
  }
  return value;
}
