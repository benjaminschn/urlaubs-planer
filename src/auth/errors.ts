const genericSignInMessage =
  "Die Anmeldung ist nicht möglich. Bitte prüfen Sie Ihre Zugangsdaten oder versuchen Sie es später erneut.";
const connectionMessage =
  "Die Anmeldung ist gerade nicht möglich. Bitte prüfen Sie Ihre Verbindung und versuchen Sie es später erneut.";
const mfaMessage =
  "Der Bestätigungscode ist ungültig oder abgelaufen. Bitte versuchen Sie es erneut.";

function errorText(error: unknown): string {
  if (error instanceof Error) {
    return error.message.toLowerCase();
  }
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    return typeof message === "string" ? message.toLowerCase() : "";
  }
  return "";
}

function looksLikeConnectionError(error: unknown): boolean {
  const message = errorText(error);
  return (
    error instanceof TypeError ||
    message.includes("network") ||
    message.includes("fetch") ||
    message.includes("timeout") ||
    message.includes("connection")
  );
}

export function mapSignInError(error: unknown): string {
  return looksLikeConnectionError(error) ? connectionMessage : genericSignInMessage;
}

export function mapMfaError(): string {
  return mfaMessage;
}

export const configurationErrorMessage =
  "Die Anwendung ist momentan nicht verfügbar. Bitte versuchen Sie es später erneut.";

export const invalidMfaConfigurationMessage =
  "Die Anmeldung ist momentan nicht verfügbar. Bitte versuchen Sie es später erneut.";
