export function LoadingScreen() {
  return (
    <main className="centered-state" aria-busy="true" aria-live="polite">
      <div className="state-card">
        <p className="eyebrow">Gemeinsamer Reiseplaner</p>
        <h1>Sitzung wird geprüft</h1>
        <p>Bitte einen Moment warten.</p>
      </div>
    </main>
  );
}
