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
import { setCanonicalStateReady } from "./network";

type UpdateCallbacks = {
  onNeedReload: () => void;
  onNeedRefresh: () => void;
  onOfflineReady: () => void;
  onRegisterError: () => void;
};

export type ServiceWorkerRegistrar = (
  callbacks: UpdateCallbacks
) => Promise<(reloadPage?: boolean) => Promise<void>>;

type ConnectionStatus = "online" | "offline" | "reconnecting";

type PwaContextValue = {
  connectionStatus: ConnectionStatus;
  offlineReady: boolean;
  updateReady: boolean;
  registrationFailed: boolean;
  hasOpenForm: boolean;
  registerResync: (key: string, callback: () => Promise<boolean>) => () => void;
  retryResync: () => Promise<void>;
  activateUpdate: () => Promise<void>;
  dismissUpdate: () => void;
};

const PwaContext = createContext<PwaContextValue | null>(null);

async function registerServiceWorker(callbacks: UpdateCallbacks) {
  const { registerSW } = await import("virtual:pwa-register");
  return registerSW({
    immediate: true,
    onNeedReload: callbacks.onNeedReload,
    onNeedRefresh: callbacks.onNeedRefresh,
    onOfflineReady: callbacks.onOfflineReady,
    onRegisterError: callbacks.onRegisterError
  });
}

function pageHasOpenForm(): boolean {
  return typeof document !== "undefined" && document.querySelector("form") !== null;
}

export function PwaProvider({
  children,
  registrar = registerServiceWorker
}: PropsWithChildren<{ registrar?: ServiceWorkerRegistrar }>) {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>(() =>
    typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "online"
  );
  const [offlineReady, setOfflineReady] = useState(false);
  const [updateReady, setUpdateReady] = useState(false);
  const [reloadPending, setReloadPending] = useState(false);
  const [registrationFailed, setRegistrationFailed] = useState(false);
  const [hasOpenForm, setHasOpenForm] = useState(false);
  const updateServiceWorker = useRef<((reloadPage?: boolean) => Promise<void>) | null>(null);
  const activationRequested = useRef(false);
  const resyncCallbacks = useRef(new Map<string, () => Promise<boolean>>());

  const runResync = useCallback(async () => {
    setCanonicalStateReady(false);
    setConnectionStatus("reconnecting");
    if (import.meta.env.VITE_E2E_AUTH === "true") {
      await new Promise((resolve) => window.setTimeout(resolve, 350));
    }
    const callbacks = [...resyncCallbacks.current.values()];
    const results = await Promise.allSettled(callbacks.map((callback) => callback()));
    const succeeded = results.every((result) => result.status === "fulfilled" && result.value);
    if (succeeded && navigator.onLine !== false) {
      setCanonicalStateReady(true);
      setConnectionStatus("online");
    }
  }, []);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    let active = true;
    void registrar({
      onNeedReload: () => {
        if (!active) return;
        if (activationRequested.current && !pageHasOpenForm()) {
          window.location.reload();
          return;
        }
        setReloadPending(true);
        setUpdateReady(true);
      },
      onNeedRefresh: () => active && setUpdateReady(true),
      onOfflineReady: () => active && setOfflineReady(true),
      onRegisterError: () => active && setRegistrationFailed(true)
    })
      .then((activate) => {
        if (active) updateServiceWorker.current = activate;
      })
      .catch(() => {
        if (active) setRegistrationFailed(true);
      });
    return () => {
      active = false;
    };
  }, [registrar]);

  useEffect(() => {
    const updateFormState = () => setHasOpenForm(pageHasOpenForm());
    updateFormState();
    const observer = new MutationObserver(updateFormState);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("hashchange", updateFormState);
    return () => {
      observer.disconnect();
      window.removeEventListener("hashchange", updateFormState);
    };
  }, []);

  useEffect(() => {
    const handleOffline = () => {
      setCanonicalStateReady(false);
      setConnectionStatus("offline");
    };
    const handleOnline = () => {
      void runResync();
    };
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, [runResync]);

  useEffect(() => {
    setCanonicalStateReady(navigator.onLine !== false);
    return () => setCanonicalStateReady(true);
  }, []);

  const registerResync = useCallback((key: string, callback: () => Promise<boolean>) => {
    resyncCallbacks.current.set(key, callback);
    return () => {
      if (resyncCallbacks.current.get(key) === callback) {
        resyncCallbacks.current.delete(key);
      }
    };
  }, []);

  const activateUpdate = useCallback(async () => {
    if (pageHasOpenForm()) {
      setHasOpenForm(true);
      return;
    }
    if (reloadPending) {
      window.location.reload();
      return;
    }
    activationRequested.current = true;
    await updateServiceWorker.current?.(true);
  }, [reloadPending]);

  const value = useMemo<PwaContextValue>(
    () => ({
      connectionStatus,
      offlineReady,
      updateReady,
      registrationFailed,
      hasOpenForm,
      registerResync,
      retryResync: runResync,
      activateUpdate,
      dismissUpdate: () => setUpdateReady(false)
    }),
    [activateUpdate, connectionStatus, hasOpenForm, offlineReady, registerResync, registrationFailed, runResync, updateReady]
  );

  return <PwaContext.Provider value={value}>{children}</PwaContext.Provider>;
}

export function usePwa(): PwaContextValue {
  const value = useContext(PwaContext);
  if (!value) throw new Error("usePwa muss innerhalb von PwaProvider verwendet werden.");
  return value;
}

export function useOptionalPwa(): PwaContextValue | null {
  return useContext(PwaContext);
}
