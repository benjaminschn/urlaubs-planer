import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
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
};

const RouterContext = createContext<RouterContextValue | null>(null);

export function HashRouter({ children }: PropsWithChildren) {
  const [path, setPath] = useState(() => currentPathFromLocation(window.location));

  useEffect(() => {
    const updateFromLocation = () => setPath(currentPathFromLocation(window.location));
    window.addEventListener("hashchange", updateFromLocation);
    window.addEventListener("popstate", updateFromLocation);
    return () => {
      window.removeEventListener("hashchange", updateFromLocation);
      window.removeEventListener("popstate", updateFromLocation);
    };
  }, []);

  const navigate = useCallback((nextPath: string, options: NavigateOptions = {}) => {
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
      window.location.hash = nextHash;
    }
    setPath(currentPathFromLocation(window.location));
  }, []);

  const value = useMemo(
    () => ({ route: routeFromHash(`#${path}`), navigate }),
    [navigate, path]
  );
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useRouter(): RouterContextValue {
  const value = useContext(RouterContext);
  if (!value) {
    throw new Error("useRouter muss innerhalb von HashRouter verwendet werden.");
  }
  return value;
}
