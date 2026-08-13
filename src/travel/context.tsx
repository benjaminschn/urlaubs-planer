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
  TravelItem,
  TravelItemGateway,
  TravelItemMutationResult,
  TravelItemPayload,
  TravelItemRealtimeStatus
} from "./types";
import { isNetworkAvailable, offlineActionMessage } from "../pwa/network";
import { useOptionalPwa } from "../pwa/context";

export type TravelItemState =
  | { status: "idle" | "loading" | "disabled"; items: TravelItem[]; message?: string }
  | { status: "error"; items: TravelItem[]; message: string }
  | { status: "ready"; items: TravelItem[]; message?: string };

type TravelItemContextValue = {
  state: TravelItemState;
  realtimeStatus: TravelItemRealtimeStatus;
  isRefreshing: boolean;
  isSaving: boolean;
  reload: () => Promise<TravelItem[]>;
  getItem: (itemId: string) => TravelItem | null;
  create: (payload: TravelItemPayload, idempotencyKey: string) => Promise<TravelItemMutationResult>;
  update: (
    itemId: string,
    expectedVersion: number,
    payload: TravelItemPayload,
    idempotencyKey: string
  ) => Promise<TravelItemMutationResult>;
  remove: (itemId: string, expectedVersion: number, idempotencyKey: string) => Promise<TravelItemMutationResult>;
};

const TravelItemContext = createContext<TravelItemContextValue | null>(null);
const loadErrorMessage = "Die Reiseereignisse konnten nicht geladen werden. Bitte versuchen Sie es erneut.";
const saveErrorMessage = "Das Ereignis konnte nicht gespeichert werden. Ihre Eingaben bleiben erhalten.";
const conflictMessage = "Das Ereignis wurde zwischenzeitlich geändert. Der neue Stand wurde geladen.";

type ProviderProps = PropsWithChildren<{ gateway: TravelItemGateway | null }>;

export function TravelItemProvider({ children, gateway }: ProviderProps) {
  const { state: authState } = useAuth();
  const pwa = useOptionalPwa();
  const { state: tripState } = useTrip();
  const [state, setState] = useState<TravelItemState>({ status: "idle", items: [] });
  const [realtimeStatus, setRealtimeStatus] = useState<TravelItemRealtimeStatus>("connecting");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const requestNumber = useRef(0);
  const stateRef = useRef(state);
  const savingRef = useRef(false);
  const lastReloadSucceeded = useRef(false);
  stateRef.current = state;
  const activeUserId = authState.status === "authenticated" ? authState.user.id : null;
  const trip = tripState.status === "ready" ? tripState.trip : null;

  const reload = useCallback(async (): Promise<TravelItem[]> => {
    if (!activeUserId || !trip || !gateway) {
      return [];
    }
    const request = ++requestNumber.current;
    const currentState = stateRef.current;
    if (currentState.status === "ready" || currentState.status === "error") {
      setIsRefreshing(true);
    } else {
      setState({ status: "loading", items: [] });
    }
    const result = await gateway.getTravelItems(trip.id);
    if (request !== requestNumber.current) return [];
    setIsRefreshing(false);
    if (result.kind === "ready") {
      lastReloadSucceeded.current = true;
      setState({ status: "ready", items: result.items });
      return result.items;
    }
    lastReloadSucceeded.current = false;
    if (currentState.status === "ready" || currentState.status === "error") {
      setState({ status: "ready", items: currentState.items, message: loadErrorMessage });
      return currentState.items;
    }
    setState({ status: "error", items: [], message: loadErrorMessage });
    return [];
  }, [activeUserId, gateway, trip]);

  useEffect(() => {
    requestNumber.current += 1;
    setRealtimeStatus("connecting");
    setIsRefreshing(false);
    if (!activeUserId || !trip) {
      setState({ status: "idle", items: [] });
      return;
    }
    if (!gateway) {
      setState({ status: "disabled", items: [] });
      return;
    }
    void reload();
  }, [activeUserId, gateway, reload, trip]);

  useEffect(() => {
    if ((state.status !== "ready" && state.status !== "error") || !gateway || !trip) return;
    return gateway.subscribeToTravelItems({
      tripId: trip.id,
      onSignal: () => void reload(),
      onStatus: setRealtimeStatus
    });
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

  useEffect(() => pwa?.registerResync("travel-items", async () => {
    await reload();
    return lastReloadSucceeded.current;
  }), [pwa, reload]);

  const applyMutationResult = useCallback((result: TravelItemMutationResult): TravelItemMutationResult => {
    if (result.kind === "created" || result.kind === "updated") {
      setState((current) => {
        const items = current.items.filter((item) => item.id !== result.item.id);
        return { status: "ready", items: [...items, result.item] };
      });
    } else if (result.kind === "deleted") {
      setState((current) => ({
        status: "ready",
        items: current.items.filter((item) => item.id !== result.itemId)
      }));
    } else if (result.kind === "conflict") {
      setState((current) => {
        if (!result.item) return { ...current, message: conflictMessage };
        const items = current.items.filter((item) => item.id !== result.item?.id);
        return { status: "ready", items: [...items, result.item], message: conflictMessage };
      });
    } else if (result.kind === "validation" || result.kind === "limit" || result.kind === "forbidden") {
      setState((current) => ({ ...current, message: result.message }));
    } else {
      setState((current) => ({ ...current, message: result.message || saveErrorMessage }));
    }
    return result;
  }, []);

  const runMutation = useCallback(
    async (operation: () => Promise<TravelItemMutationResult>): Promise<TravelItemMutationResult> => {
      if (!isNetworkAvailable()) {
        return applyMutationResult({ kind: "unavailable", message: offlineActionMessage });
      }
      if (savingRef.current || !gateway || !trip || stateRef.current.status !== "ready") {
        return { kind: "unavailable", message: saveErrorMessage };
      }
      savingRef.current = true;
      setIsSaving(true);
      try {
        return applyMutationResult(await operation());
      } catch {
        const result: TravelItemMutationResult = { kind: "unavailable", message: saveErrorMessage };
        return applyMutationResult(result);
      } finally {
        savingRef.current = false;
        setIsSaving(false);
      }
    },
    [applyMutationResult, gateway, trip]
  );

  const create = useCallback(
    (payload: TravelItemPayload, idempotencyKey: string) =>
      runMutation(() => gateway && trip
        ? gateway.createTravelItem({ tripId: trip.id, payload, idempotencyKey })
        : Promise.resolve({ kind: "unavailable", message: saveErrorMessage })),
    [gateway, runMutation, trip]
  );

  const update = useCallback(
    (itemId: string, expectedVersion: number, payload: TravelItemPayload, idempotencyKey: string) =>
      runMutation(() => gateway && trip
        ? gateway.updateTravelItem({ tripId: trip.id, travelItemId: itemId, expectedVersion, payload, idempotencyKey })
        : Promise.resolve({ kind: "unavailable", message: saveErrorMessage })),
    [gateway, runMutation, trip]
  );

  const remove = useCallback(
    (itemId: string, expectedVersion: number, idempotencyKey: string) =>
      runMutation(() => gateway && trip
        ? gateway.deleteTravelItem({ tripId: trip.id, travelItemId: itemId, expectedVersion, idempotencyKey })
        : Promise.resolve({ kind: "unavailable", message: saveErrorMessage })),
    [gateway, runMutation, trip]
  );

  const value = useMemo<TravelItemContextValue>(
    () => ({
      state,
      realtimeStatus,
      isRefreshing,
      isSaving,
      reload,
      getItem: (itemId) => state.items.find((item) => item.id === itemId) ?? null,
      create,
      update,
      remove
    }),
    [create, isRefreshing, isSaving, realtimeStatus, reload, remove, state, update]
  );
  return <TravelItemContext.Provider value={value}>{children}</TravelItemContext.Provider>;
}

export function useTravelItems(): TravelItemContextValue {
  const value = useContext(TravelItemContext);
  if (!value) throw new Error("useTravelItems muss innerhalb von TravelItemProvider verwendet werden.");
  return value;
}
