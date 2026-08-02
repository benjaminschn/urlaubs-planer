import { useRouter } from "../router/HashRouter";

export function InviteDisabledPage() {
  const { navigate } = useRouter();
  return (
    <main className="centered-state">
      <section className="state-card" aria-labelledby="invite-title">
        <p className="eyebrow">Gemeinsamer Reiseplaner</p>
        <h1 id="invite-title">Einladungen werden nicht unterstützt</h1>
        <p>Bitte melden Sie sich mit einem vorab eingerichteten persönlichen Konto an.</p>
        <button className="primary-button" type="button" onClick={() => navigate("/login", { replace: true })}>
          Zur Anmeldung
        </button>
      </section>
    </main>
  );
}
