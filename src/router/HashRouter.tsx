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
import {
  currentPathFromLocation,
  hashForPath,
  routeFromHash,
  type AppRoute
} from "./routes";

type NavigateOptions = { replace?: boolean };
type RouterContextValue = {
  route: AppRoute;
  navigate: (path: string, options?: NavigateOptions) => void;
  confirmNavigation: () => boolean;
  setNavigationGuard: (guard: (() => boolean) | null) => void;
};

const RouterContext = createContext<RouterContextValue | null>(null);

export function HashRouter({ children }: PropsWithChildren) {
  const [path, setPath] = useState(() => currentPathFromLocation(window.location));
  const pathRef = useRef(path);
  const guardRef = useRef<(() => boolean) | null>(null);
  const allowNextLocationRef = useRef(false);
  pathRef.current = path;
  const confirmNavigation = useCallback(() => guardRef.current?.() ?? true, []);
  const setNavigationGuard = useCallback((guard: (() => boolean) | null) => {
    guardRef.current = guard;
  }, []);

  useEffect(() => {
    const updateFromLocation = () => {
      const nextPath = currentPathFromLocation(window.location);
      if (allowNextLocationRef.current) {
        allowNextLocationRef.current = false;
        setPath(nextPath);
        return;
      }
      if (nextPath !== pathRef.current && !(guardRef.current?.() ?? true)) {
        window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}${hashForPath(pathRef.current)}`);
        return;
      }
      setPath(nextPath);
    };
    window.addEventListener("hashchange", updateFromLocation);
    window.addEventListener("popstate", updateFromLocation);
    return () => {
      window.removeEventListener("hashchange", updateFromLocation);
      window.removeEventListener("popstate", updateFromLocation);
    };
  }, []);

  const navigate = useCallback((nextPath: string, options: NavigateOptions = {}) => {
    if (nextPath !== pathRef.current && !(guardRef.current?.() ?? true)) return;
    const nextHash = hashForPath(nextPath);
    if (options.replace) {
      window.history.replaceState(
        window.history.state,
        "",
        `${window.location.pathname}${window.location.search}${nextHash}`
      );
      setPath(currentPathFromLocation(window.location));
      return;
    }
    if (window.location.hash !== nextHash) {
      allowNextLocationRef.current = true;
      window.location.hash = nextHash;
    }
    setPath(currentPathFromLocation(window.location));
  }, []);

  const value = useMemo(
    () => ({ route: routeFromHash(`#${path}`), navigate, confirmNavigation, setNavigationGuard }),
    [confirmNavigation, navigate, path, setNavigationGuard]
  );
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useNavigationGuard(enabled: boolean, message: string): void {
  const { setNavigationGuard } = useRouter();
  useEffect(() => {
    if (!enabled) return;
    const guard = () => window.confirm(message);
    setNavigationGuard(guard);
    return () => setNavigationGuard(null);
  }, [enabled, message, setNavigationGuard]);
}

export function useRouter(): RouterContextValue {
  const value = useContext(RouterContext);
  if (!value) {
    throw new Error("useRouter muss innerhalb von HashRouter verwendet werden.");
  }
  return value;
}
