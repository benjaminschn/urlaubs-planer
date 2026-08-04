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
import { configurationErrorMessage } from "./errors";
import { createAuthController, type AuthController } from "./controller";
import { createRuntimeAuthGateway } from "@runtime-auth";
import type { AuthGateway, AuthState } from "./types";

type AuthContextValue = {
  state: AuthState;
  controller: AuthController | null;
  signIn: (email: string, password: string) => Promise<void>;
  verifyMfa: (code: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

type AuthProviderProps = PropsWithChildren<{ gateway?: AuthGateway | null }>;

export function AuthProvider({ children, gateway: providedGateway }: AuthProviderProps) {
  const runtimeGateway = useMemo(
    () => (providedGateway === undefined ? createRuntimeAuthGateway() : providedGateway),
    [providedGateway]
  );
  const controllerRef = useRef<AuthController | null>(null);
  const [controller, setController] = useState<AuthController | null>(null);
  const [state, setState] = useState<AuthState>(() =>
    runtimeGateway
      ? { status: "loading" }
      : {
          status: "configuration_error",
          message: configurationErrorMessage
        }
  );

  useEffect(() => {
    if (!runtimeGateway) {
      controllerRef.current = null;
      setController(null);
      setState({ status: "configuration_error", message: configurationErrorMessage });
      return;
    }

    // Create the controller inside the effect so React Strict Mode remounts get a
    // fresh instance. A memoized controller that was dispose()d stays dead forever.
    const nextController = createAuthController(runtimeGateway);
    controllerRef.current = nextController;
    setController(nextController);
    setState(nextController.getState());
    const unsubscribe = nextController.subscribe(setState);
    void nextController.initialize();

    return () => {
      unsubscribe();
      nextController.dispose();
      if (controllerRef.current === nextController) {
        controllerRef.current = null;
      }
    };
  }, [runtimeGateway]);

  useEffect(() => {
    const expireForTests = () => controllerRef.current?.expireSession();
    window.addEventListener("travel-planner:test-expire-session", expireForTests);
    return () => window.removeEventListener("travel-planner:test-expire-session", expireForTests);
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    await controllerRef.current?.signIn(email, password);
  }, []);

  const verifyMfa = useCallback(async (code: string) => {
    await controllerRef.current?.verifyMfa(code);
  }, []);

  const signOut = useCallback(async () => {
    await controllerRef.current?.signOut();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      state,
      controller,
      signIn,
      verifyMfa,
      signOut
    }),
    [controller, signIn, signOut, state, verifyMfa]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth muss innerhalb von AuthProvider verwendet werden.");
  }
  return value;
}
