import type { AuthState, AuthUser } from "./types";

export type AuthAction =
  | { type: "LOAD" }
  | { type: "START_SIGN_IN" }
  | { type: "SIGNED_OUT"; message?: string }
  | { type: "AUTH_FAILURE"; message: string }
  | {
      type: "MFA_REQUIRED";
      factorId: string;
      challengeId: string;
    }
  | { type: "START_MFA" }
  | { type: "MFA_FAILURE"; message: string }
  | { type: "AUTHENTICATED"; user: AuthUser }
  | { type: "CONFIGURATION_ERROR"; message: string };

export const initialAuthState: AuthState = { status: "loading" };

export function authReducer(state: AuthState, action: AuthAction): AuthState {
  switch (action.type) {
    case "LOAD":
      return { status: "loading" };
    case "START_SIGN_IN":
      return { status: "signing_in" };
    case "SIGNED_OUT":
      return action.message
        ? { status: "signed_out", message: action.message }
        : { status: "signed_out" };
    case "AUTH_FAILURE":
      return { status: "signed_out", message: action.message };
    case "MFA_REQUIRED":
      return {
        status: "mfa_required",
        factorId: action.factorId,
        challengeId: action.challengeId
      };
    case "START_MFA":
      if (state.status !== "mfa_required") {
        return state;
      }
      return {
        status: "verifying_mfa",
        factorId: state.factorId,
        challengeId: state.challengeId
      };
    case "MFA_FAILURE":
      if (state.status !== "mfa_required" && state.status !== "verifying_mfa") {
        return state;
      }
      return {
        status: "mfa_required",
        factorId: state.factorId,
        challengeId: state.challengeId,
        message: action.message
      };
    case "AUTHENTICATED":
      return { status: "authenticated", user: action.user };
    case "CONFIGURATION_ERROR":
      return { status: "configuration_error", message: action.message };
  }
}
