import type {
  AuthChange,
  AuthFactor,
  AuthGateway,
  AuthSnapshot,
  AuthUser
} from "./types";

type E2eSession = { user: AuthUser; assurance: "aal1" | "aal2" };

const accounts = new Map([
  ["person-a@example.test", "correct-password-a"],
  ["person-b@example.test", "correct-password-b"]
]);

export function createRuntimeAuthGateway(): AuthGateway {
  let session: E2eSession | null = null;
  let challengeCounter = 0;
  const listeners = new Set<(change: AuthChange) => void>();

  const snapshot = (): AuthSnapshot => ({
    session,
    user: session?.user ?? null
  });
  const emit = (type: AuthChange["type"]): void => {
    for (const listener of listeners) {
      listener({ type, session, user: session?.user ?? null });
    }
  };
  const waitBriefly = (): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, 40));

  return {
    async getSession() {
      return { data: snapshot(), error: null };
    },
    async signInWithPassword(email, password) {
      await waitBriefly();
      if (accounts.get(email.toLowerCase()) !== password) {
        return { data: { session: null, user: null }, error: new Error("invalid credentials") };
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
        ? [{ id: `totp-${session.user.id}`, type: "totp", status: "verified" }]
        : [];
      return { factors, error: null };
    },
    async challengeFactor() {
      challengeCounter += 1;
      return { challengeId: `challenge-${challengeCounter}`, error: null };
    },
    async verifyFactor(_factorId, _challengeId, code) {
      if (code !== "123456" || !session) {
        return { error: new Error("invalid code") };
      }
      session = { ...session, assurance: "aal2" };
      emit("MFA_CHALLENGE_VERIFIED");
      return { error: null };
    },
    async signOut() {
      session = null;
      emit("SIGNED_OUT");
      return { error: null };
    },
    onAuthStateChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
}
