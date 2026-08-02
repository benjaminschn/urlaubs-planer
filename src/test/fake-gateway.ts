import type {
  AuthChange,
  AuthFactor,
  AuthGateway,
  AuthSnapshot,
  AuthUser
} from "../auth/types";

export type FakeGatewayOptions = {
  signInError?: unknown;
  signInDelay?: number;
};

export function createFakeGateway(options: FakeGatewayOptions = {}) {
  let session: { assurance: "aal1" | "aal2"; user: AuthUser } | null = null;
  let challengeNumber = 0;
  const listeners = new Set<(change: AuthChange) => void>();
  const calls = {
    signIn: 0,
    challenge: 0,
    verify: 0,
    signOut: 0
  };
  let releaseSignIn: (() => void) | null = null;

  const snapshot = (): AuthSnapshot => ({ session, user: session?.user ?? null });
  const emit = (type: AuthChange["type"]) => {
    for (const listener of listeners) {
      listener({ type, session, user: session?.user ?? null });
    }
  };

  const gateway: AuthGateway = {
    async getSession() {
      return { data: snapshot(), error: null };
    },
    async signInWithPassword(email, password) {
      calls.signIn += 1;
      if (options.signInDelay) {
        await new Promise<void>((resolve) => {
          releaseSignIn = resolve;
          setTimeout(resolve, options.signInDelay);
        });
      }
      if (releaseSignIn) {
        releaseSignIn = null;
      }
      if (options.signInError || password !== "password") {
        return {
          data: { session: null, user: null },
          error: options.signInError ?? new Error("invalid credentials")
        };
      }
      session = {
        assurance: "aal1",
        user: { id: email.toLowerCase(), email: email.toLowerCase() }
      };
      emit("SIGNED_IN");
      return { data: snapshot(), error: null };
    },
    async getMfaAssurance() {
      return {
        currentLevel: session?.assurance ?? null,
        nextLevel: session ? "aal2" : null,
        error: null
      };
    },
    async listFactors() {
      const factors: AuthFactor[] = session
        ? [{ id: "totp-factor", type: "totp", status: "verified" }]
        : [];
      return { factors, error: null };
    },
    async challengeFactor() {
      calls.challenge += 1;
      challengeNumber += 1;
      return { challengeId: `challenge-${challengeNumber}`, error: null };
    },
    async verifyFactor(_factorId, _challengeId, code) {
      calls.verify += 1;
      if (code !== "123456") {
        return { error: new Error("invalid code") };
      }
      if (session) {
        session = { ...session, assurance: "aal2" };
      }
      emit("MFA_CHALLENGE_VERIFIED");
      return { error: null };
    },
    async signOut() {
      calls.signOut += 1;
      session = null;
      emit("SIGNED_OUT");
      return { error: null };
    },
    onAuthStateChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };

  return {
    gateway,
    calls,
    releaseSignIn: () => releaseSignIn?.()
  };
}
