export type AuthUser = {
  id: string;
  email?: string;
};

export type AuthState =
  | { status: "loading" }
  | { status: "signing_in" }
  | { status: "signed_out"; message?: string }
  | {
      status: "mfa_required";
      factorId: string;
      challengeId: string;
      message?: string;
    }
  | { status: "verifying_mfa"; factorId: string; challengeId: string }
  | { status: "authenticated"; user: AuthUser }
  | { status: "configuration_error"; message: string };

export type AuthFactor = {
  id: string;
  type: "totp" | "unknown";
  status: "verified" | "unverified" | "unknown";
};

export type AuthSnapshot = {
  session: unknown | null;
  user: AuthUser | null;
};

export type AuthChange = {
  type:
    | "INITIAL_SESSION"
    | "SIGNED_IN"
    | "SIGNED_OUT"
    | "TOKEN_REFRESHED"
    | "USER_UPDATED"
    | "MFA_CHALLENGE_VERIFIED";
  session: unknown | null;
  user: AuthUser | null;
};

export type AuthGateway = {
  getSession: () => Promise<{ data: AuthSnapshot; error: unknown | null }>;
  signInWithPassword: (
    email: string,
    password: string
  ) => Promise<{ data: AuthSnapshot; error: unknown | null }>;
  getMfaAssurance: () => Promise<{
    currentLevel: string | null;
    nextLevel: string | null;
    error: unknown | null;
  }>;
  listFactors: () => Promise<{
    factors: AuthFactor[];
    error: unknown | null;
  }>;
  challengeFactor: (factorId: string) => Promise<{
    challengeId: string | null;
    error: unknown | null;
  }>;
  verifyFactor: (
    factorId: string,
    challengeId: string,
    code: string
  ) => Promise<{ error: unknown | null }>;
  signOut: () => Promise<{ error: unknown | null }>;
  onAuthStateChange: (listener: (change: AuthChange) => void) => () => void;
};
