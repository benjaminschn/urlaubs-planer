import { useRouter } from "../router/HashRouter";

export function NotFoundPage() {
  const { navigate } = useRouter();
  return (
    <main className="centered-state">
      <section className="state-card" aria-labelledby="not-found-title">
        <p className="eyebrow">Gemeinsamer Reiseplaner</p>
        <h1 id="not-found-title">Seite nicht gefunden</h1>
        <p>Dieser Bereich ist nicht verfügbar oder wurde verschoben.</p>
        <button className="primary-button" type="button" onClick={() => navigate("/app", { replace: true })}>
          Zur Übersicht
        </button>
      </section>
    </main>
  );
}
