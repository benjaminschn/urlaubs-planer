import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AuthChange,
  AuthFactor,
  AuthGateway,
  AuthSnapshot
} from "./types";

function mapUser(user: { id: string; email?: string | undefined } | null): AuthSnapshot["user"] {
  return user ? { id: user.id, email: user.email } : null;
}

function mapSnapshot(session: { user?: { id: string; email?: string | undefined } } | null): AuthSnapshot {
  return {
    session,
    user: mapUser(session?.user ?? null)
  };
}

function mapFactor(factor: {
  id: string;
  factor_type?: string;
  type?: string;
  status?: string;
}): AuthFactor {
  return {
    id: factor.id,
    type: factor.factor_type === "totp" || factor.type === "totp" ? "totp" : "unknown",
    status:
      factor.status === "verified"
        ? "verified"
        : factor.status === "unverified"
          ? "unverified"
          : "unknown"
  };
}

export function createSupabaseAuthGateway(client: SupabaseClient): AuthGateway {
  return {
    async getSession() {
      const { data, error } = await client.auth.getSession();
      return { data: mapSnapshot(data.session), error };
    },
    async signInWithPassword(email, password) {
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      return { data: mapSnapshot(data.session), error };
    },
    async getMfaAssurance() {
      const { data, error } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
      return {
        currentLevel: data?.currentLevel ?? null,
        nextLevel: data?.nextLevel ?? null,
        error
      };
    },
    async listFactors() {
      const { data, error } = await client.auth.mfa.listFactors();
      const all = data?.all ?? data?.totp ?? [];
      return { factors: all.map(mapFactor), error };
    },
    async challengeFactor(factorId) {
      const { data, error } = await client.auth.mfa.challenge({ factorId });
      return { challengeId: data?.id ?? null, error };
    },
    async verifyFactor(factorId, challengeId, code) {
      const { error } = await client.auth.mfa.verify({ factorId, challengeId, code });
      return { error };
    },
    async signOut() {
      const { error } = await client.auth.signOut({ scope: "local" });
      return { error };
    },
    onAuthStateChange(listener) {
      const { data } = client.auth.onAuthStateChange((event, session) => {
        if (event === "PASSWORD_RECOVERY") {
          return;
        }
        const type: AuthChange["type"] =
          event === "MFA_CHALLENGE_VERIFIED" ? "MFA_CHALLENGE_VERIFIED" : event;
        listener({ type, session, user: mapUser(session?.user ?? null) });
      });
      return () => data.subscription.unsubscribe();
    }
  };
}
