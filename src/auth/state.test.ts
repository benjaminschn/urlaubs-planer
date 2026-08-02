import { describe, expect, it } from "vitest";
import { authReducer, initialAuthState } from "./state";

describe("Auth-Zustandsautomat", () => {
  it("hält geschützte Inhalte bis nach der MFA-Prüfung verborgen", () => {
    const signingIn = authReducer(initialAuthState, { type: "START_SIGN_IN" });
    const mfa = authReducer(signingIn, {
      type: "MFA_REQUIRED",
      factorId: "factor-1",
      challengeId: "challenge-1"
    });
    const verifying = authReducer(mfa, { type: "START_MFA" });

    expect(signingIn.status).toBe("signing_in");
    expect(mfa.status).toBe("mfa_required");
    expect(verifying.status).toBe("verifying_mfa");
    expect(verifying).not.toHaveProperty("user");
  });

  it("führt nach erfolgreicher MFA in den geschützten Zustand und nach Logout zurück", () => {
    const authenticated = authReducer(
      { status: "mfa_required", factorId: "f", challengeId: "c" },
      { type: "AUTHENTICATED", user: { id: "member-a" } }
    );
    const signedOut = authReducer(authenticated, { type: "SIGNED_OUT" });

    expect(authenticated).toEqual({ status: "authenticated", user: { id: "member-a" } });
    expect(signedOut).toEqual({ status: "signed_out" });
  });

  it("verliert bei einer neutralen Authentifizierungsfehlermeldung keine Kontoinformation", () => {
    const state = authReducer(initialAuthState, {
      type: "AUTH_FAILURE",
      message: "Die Anmeldung ist nicht möglich."
    });

    expect(state).toEqual({ status: "signed_out", message: "Die Anmeldung ist nicht möglich." });
    expect(JSON.stringify(state)).not.toContain("example@email.com");
  });
});
