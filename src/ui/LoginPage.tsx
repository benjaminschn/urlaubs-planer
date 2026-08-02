import { useEffect, useRef, useState, type FormEvent } from "react";
import { useAuth } from "../auth/context";

type LoginPageProps = { onCancelMfa?: () => void };

export function LoginPage({ onCancelMfa }: LoginPageProps) {
  const { state, signIn, verifyMfa } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const mfaInputRef = useRef<HTMLInputElement>(null);
  const signInPending = state.status === "signing_in";
  const mfaPending = state.status === "verifying_mfa";
  const mfaRequired = state.status === "mfa_required" || mfaPending;
  const message =
    state.status === "signed_out" || state.status === "mfa_required" ? state.message : undefined;

  useEffect(() => {
    if (mfaRequired) {
      mfaInputRef.current?.focus();
    }
  }, [mfaRequired]);

  async function handleSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (signInPending || mfaRequired) {
      return;
    }
    await signIn(email.trim(), password);
  }

  async function handleMfa(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mfaPending || state.status !== "mfa_required") {
      return;
    }
    await verifyMfa(code.trim());
  }

  if (mfaRequired) {
    return (
      <main className="auth-page">
        <section className="auth-card" aria-labelledby="mfa-title">
          <p className="eyebrow">Gemeinsamer Reiseplaner</p>
          <h1 id="mfa-title">Bestätigung erforderlich</h1>
          <p className="intro">Geben Sie den sechsstelligen Code aus Ihrer Authenticator-App ein.</p>
          {message ? (
            <div id="mfa-error" className="error-summary" role="alert" aria-live="assertive">
              <p>{message}</p>
            </div>
          ) : null}
          <form onSubmit={handleMfa} noValidate>
            <div className="field">
              <label htmlFor="mfa-code">Bestätigungscode</label>
              <input
                ref={mfaInputRef}
                id="mfa-code"
                name="mfa-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={6}
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
                aria-describedby={message ? "mfa-error" : undefined}
              />
            </div>
            <button className="primary-button" type="submit" disabled={mfaPending || code.length !== 6}>
              {mfaPending ? "Code wird geprüft …" : "Bestätigen"}
            </button>
          </form>
          <button className="link-button" type="button" onClick={onCancelMfa} disabled={mfaPending}>
            Abbrechen
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="login-title">
        <p className="eyebrow">Gemeinsamer Reiseplaner</p>
        <h1 id="login-title">Anmelden</h1>
        <p className="intro">Melden Sie sich an, um auf Ihre gemeinsame Reise zuzugreifen.</p>
        {message ? (
          <div id="login-error" className="error-summary" role="alert" aria-live="assertive">
            <p>{message}</p>
          </div>
        ) : null}
        <form onSubmit={handleSignIn} noValidate aria-describedby={message ? "login-error" : undefined}>
          <div className="field">
            <label htmlFor="email">E-Mail-Adresse</label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              inputMode="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="password">Passwort</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          <button className="primary-button" type="submit" disabled={signInPending} aria-busy={signInPending}>
            {signInPending ? "Anmeldung läuft …" : "Anmelden"}
          </button>
        </form>
      </section>
    </main>
  );
}
