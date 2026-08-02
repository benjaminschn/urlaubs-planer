import {
  authReducer,
  initialAuthState,
  type AuthAction
} from "./state";
import {
  invalidMfaConfigurationMessage,
  mapMfaError,
  mapSignInError
} from "./errors";
import type {
  AuthChange,
  AuthGateway,
  AuthState,
  AuthUser
} from "./types";

export type AuthController = {
  getState: () => AuthState;
  subscribe: (listener: (state: AuthState) => void) => () => void;
  initialize: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  verifyMfa: (code: string) => Promise<void>;
  signOut: () => Promise<void>;
  expireSession: () => void;
  dispose: () => void;
};

export function createAuthController(gateway: AuthGateway): AuthController {
  let state = initialAuthState;
  let disposed = false;
  let sessionOperation = 0;
  let initializationPromise: Promise<void> | null = null;
  let signInPromise: Promise<void> | null = null;
  let mfaPromise: Promise<void> | null = null;
  let signOutPromise: Promise<void> | null = null;
  let unsubscribeFromAuth: (() => void) | null = null;
  const listeners = new Set<(nextState: AuthState) => void>();

  function dispatch(action: AuthAction): void {
    if (disposed) {
      return;
    }
    state = authReducer(state, action);
    for (const listener of listeners) {
      listener(state);
    }
  }

  function invalidateSession(): void {
    sessionOperation += 1;
  }

  function setSignedOut(message?: string): void {
    invalidateSession();
    dispatch({ type: "SIGNED_OUT", message });
  }

  async function syncSession(
    session: unknown | null,
    user: AuthUser | null,
    failureMode: "initial" | "sign_in" | "session"
  ): Promise<void> {
    const operation = ++sessionOperation;
    if (!session || !user) {
      setSignedOut();
      return;
    }

    if (failureMode === "initial") {
      dispatch({ type: "LOAD" });
    }

    try {
      const assurance = await gateway.getMfaAssurance();
      if (disposed || operation !== sessionOperation) {
        return;
      }
      if (assurance.error) {
        throw assurance.error;
      }

      const mfaRequired =
        assurance.nextLevel === "aal2" && assurance.currentLevel !== "aal2";
      if (!mfaRequired) {
        dispatch({ type: "AUTHENTICATED", user });
        return;
      }

      const factorResult = await gateway.listFactors();
      if (disposed || operation !== sessionOperation) {
        return;
      }
      if (factorResult.error) {
        throw factorResult.error;
      }
      const factor = factorResult.factors.find(
        (candidate) => candidate.type === "totp" && candidate.status === "verified"
      );
      if (!factor) {
        throw new Error(invalidMfaConfigurationMessage);
      }

      const challengeResult = await gateway.challengeFactor(factor.id);
      if (disposed || operation !== sessionOperation) {
        return;
      }
      if (challengeResult.error || !challengeResult.challengeId) {
        throw challengeResult.error ?? new Error("MFA challenge unavailable");
      }
      dispatch({
        type: "MFA_REQUIRED",
        factorId: factor.id,
        challengeId: challengeResult.challengeId
      });
    } catch (error) {
      if (disposed || operation !== sessionOperation) {
        return;
      }
      if (failureMode === "session") {
        setSignedOut(mapSignInError(error));
      } else {
        dispatch({ type: "AUTH_FAILURE", message: mapSignInError(error) });
      }
    }
  }

  function handleAuthChange(change: AuthChange): void {
    if (disposed) {
      return;
    }
    if (change.type === "SIGNED_OUT") {
      setSignedOut();
      return;
    }
    if (signInPromise || mfaPromise) {
      return;
    }
    void syncSession(change.session, change.user, "session");
  }

  async function initialize(): Promise<void> {
    if (initializationPromise) {
      return initializationPromise;
    }
    unsubscribeFromAuth = gateway.onAuthStateChange(handleAuthChange);
    initializationPromise = (async () => {
      dispatch({ type: "LOAD" });
      const result = await gateway.getSession();
      if (disposed) {
        return;
      }
      if (result.error) {
        setSignedOut(mapSignInError(result.error));
        return;
      }
      await syncSession(result.data.session, result.data.user, "initial");
    })();
    return initializationPromise;
  }

  async function signIn(email: string, password: string): Promise<void> {
    if (signInPromise || mfaPromise || signOutPromise) {
      return signInPromise ?? Promise.resolve();
    }

    signInPromise = (async () => {
      dispatch({ type: "START_SIGN_IN" });
      const result = await gateway.signInWithPassword(email, password);
      if (disposed) {
        return;
      }
      if (result.error || !result.data.session || !result.data.user) {
        dispatch({
          type: "AUTH_FAILURE",
          message: mapSignInError(result.error)
        });
        return;
      }
      await syncSession(result.data.session, result.data.user, "sign_in");
    })().catch((error: unknown) => {
      if (!disposed) {
        dispatch({ type: "AUTH_FAILURE", message: mapSignInError(error) });
      }
    });

    try {
      await signInPromise;
    } finally {
      signInPromise = null;
    }
  }

  async function verifyMfa(code: string): Promise<void> {
    if (mfaPromise || signInPromise || signOutPromise || state.status !== "mfa_required") {
      return;
    }
    const { factorId, challengeId } = state;
    mfaPromise = (async () => {
      dispatch({ type: "START_MFA" });
      const result = await gateway.verifyFactor(factorId, challengeId, code);
      if (disposed) {
        return;
      }
      if (result.error) {
        dispatch({ type: "MFA_FAILURE", message: mapMfaError() });
        return;
      }
      const sessionResult = await gateway.getSession();
      if (disposed) {
        return;
      }
      if (sessionResult.error || !sessionResult.data.session || !sessionResult.data.user) {
        setSignedOut(mapMfaError());
        return;
      }
      await syncSession(sessionResult.data.session, sessionResult.data.user, "session");
    })().catch(() => {
      if (!disposed) {
        dispatch({ type: "MFA_FAILURE", message: mapMfaError() });
      }
    });

    try {
      await mfaPromise;
    } finally {
      mfaPromise = null;
    }
  }

  async function signOut(): Promise<void> {
    if (signOutPromise) {
      return signOutPromise;
    }
    invalidateSession();
    dispatch({ type: "SIGNED_OUT" });
    signOutPromise = gateway
      .signOut()
      .then(() => undefined)
      .catch(() => undefined);
    try {
      await signOutPromise;
    } finally {
      signOutPromise = null;
    }
  }

  function expireSession(): void {
    setSignedOut();
  }

  function dispose(): void {
    if (disposed) {
      return;
    }
    disposed = true;
    sessionOperation += 1;
    unsubscribeFromAuth?.();
    unsubscribeFromAuth = null;
    listeners.clear();
  }

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
    initialize,
    signIn,
    verifyMfa,
    signOut,
    expireSession,
    dispose
  };
}
