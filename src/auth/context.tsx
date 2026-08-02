import {
  createContext,
  useContext,
  useEffect,
  useMemo,
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
  const controller = useMemo(
    () => (runtimeGateway ? createAuthController(runtimeGateway) : null),
    [runtimeGateway]
  );
  const [state, setState] = useState<AuthState>(() =>
    controller?.getState() ?? {
      status: "configuration_error",
      message: configurationErrorMessage
    }
  );

  useEffect(() => {
    if (!controller) {
      setState({ status: "configuration_error", message: configurationErrorMessage });
      return;
    }
    const unsubscribe = controller.subscribe(setState);
    void controller.initialize();
    return () => {
      unsubscribe();
      controller.dispose();
    };
  }, [controller]);

  useEffect(() => {
    if (!controller) {
      return;
    }
    const expireForTests = () => controller.expireSession();
    window.addEventListener("travel-planner:test-expire-session", expireForTests);
    return () => window.removeEventListener("travel-planner:test-expire-session", expireForTests);
  }, [controller]);

  const value = useMemo<AuthContextValue>(
    () => ({
      state,
      controller,
      signIn: (email, password) => controller?.signIn(email, password) ?? Promise.resolve(),
      verifyMfa: (code) => controller?.verifyMfa(code) ?? Promise.resolve(),
      signOut: () => controller?.signOut() ?? Promise.resolve()
    }),
    [controller, state]
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
