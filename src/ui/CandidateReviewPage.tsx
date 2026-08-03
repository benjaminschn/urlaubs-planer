import { useEffect, useMemo, useRef, useState } from "react";
import { candidateToCanonicalPayload, validateCanonicalPayload } from "../documents/candidate-review";
import { candidateFieldSummary } from "../documents/extraction";
import { useDocuments } from "../documents/context";
import { useRouter } from "../router/HashRouter";
import { candidateRouteFromPath } from "../router/routes";
import { eventTypeLabels } from "../travel/format";
import type { EventTypeCode } from "../travel/types";
import type { CandidateMutationResult } from "../documents/types";

export function CandidateReviewPage() {
  const { route, navigate } = useRouter();
  const { state, getCandidate, download, saveCandidateReview, discardCandidate, confirmCandidate } = useDocuments();
  const candidateRoute = candidateRouteFromPath(route.path);
  const record = candidateRoute ? getCandidate(candidateRoute.candidateId) : null;
  const initialPayload = useMemo(() => record ? candidateToCanonicalPayload(record.candidate) : null, [record]);
  const [draft, setDraft] = useState(() => initialPayload ? JSON.stringify(initialPayload, null, 2) : "");
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  const confirmationKey = useRef(crypto.randomUUID());

  useEffect(() => {
    if (!dirty && initialPayload) setDraft(JSON.stringify(initialPayload, null, 2));
  }, [dirty, initialPayload]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty) event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  useEffect(() => () => {
    if (originalUrl) URL.revokeObjectURL(originalUrl);
  }, [originalUrl]);

  function parseDraft(): Record<string, unknown> | null {
    try {
      const parsed = JSON.parse(draft) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
    } catch {
      return null;
    }
  }

  function updateCore(key: "event_type_code" | "title", value: string) {
    const payload = parseDraft() ?? {};
    payload[key] = value;
    setDraft(JSON.stringify(payload, null, 2));
    setDirty(true);
    setMessage(null);
  }

  function updateStartDate(value: string) {
    const payload = parseDraft() ?? {};
    const start = payload.start_time && typeof payload.start_time === "object" && !Array.isArray(payload.start_time)
      ? payload.start_time as Record<string, unknown>
      : {};
    payload.start_time = { ...start, local_date: value, precision: start.precision ?? "date_only", resolution_status: start.resolution_status ?? "date_only" };
    setDraft(JSON.stringify(payload, null, 2));
    setDirty(true);
    setMessage(null);
  }

  async function save(): Promise<CandidateMutationResult | null> {
    if (!record) return null;
    const payload = parseDraft();
    if (!payload) {
      setMessage("Der vollständige Entwurf ist kein gültiges JSON-Objekt.");
      return null;
    }
    const errors = validateCanonicalPayload(payload);
    if (errors.length) {
      setMessage(errors.join(" "));
      return null;
    }
    setIsSaving(true);
    const result = await saveCandidateReview(record.candidate.id, record.candidate.version, payload);
    setIsSaving(false);
    if (result.kind === "updated") {
      setDirty(false);
      setMessage("Korrektur gespeichert. Originalwerte bleiben unverändert nachvollziehbar.");
      return result;
    }
    setMessage(result.kind === "conflict" ? result.message : "message" in result ? result.message : "Korrektur konnte nicht gespeichert werden.");
    return result;
  }

  async function confirm() {
    if (!record) return;
    const payload = parseDraft();
    if (!payload) {
      setMessage("Der vollständige Entwurf ist kein gültiges JSON-Objekt.");
      return;
    }
    let expectedVersion = record.candidate.version;
    if (dirty || !record.candidate.canonicalPayload) {
      const saved = await save();
      if (!saved || saved.kind !== "updated") return;
      expectedVersion = saved.version;
    }
    setIsSaving(true);
    setMessage("Speicherstatus wird geprüft …");
    const result = await confirmCandidate(record.candidate.id, expectedVersion, payload, confirmationKey.current);
    setIsSaving(false);
    if (result.kind === "created" || result.kind === "replayed") {
      navigate(`/events/${result.travelItemId}`, { replace: true });
      return;
    }
    setMessage(result.kind === "conflict" ? result.message : "message" in result ? result.message : "Der Speicherstatus konnte nicht bestätigt werden.");
  }

  async function discard() {
    if (!record || !window.confirm("Entwurf verwerfen? Original und Korrekturen bleiben für die Nachvollziehbarkeit erhalten; es wird kein Ereignis erzeugt.")) return;
    setIsSaving(true);
    const result = await discardCandidate(record.candidate.id, record.candidate.version);
    setIsSaving(false);
    if (result.kind === "discarded") navigate("/documents", { replace: true });
    else setMessage(result.kind === "conflict" ? result.message : "message" in result ? result.message : "Entwurf konnte nicht verworfen werden.");
  }

  async function openOriginal() {
    if (!record) return;
    const result = await download(record.document.id);
    if (result.kind !== "downloaded") {
      setMessage(result.message);
      return;
    }
    if (originalUrl) URL.revokeObjectURL(originalUrl);
    setOriginalUrl(URL.createObjectURL(result.blob));
  }

  if (state.status === "loading" || state.status === "idle") return <section className="state-card"><p>Entwurf wird geladen …</p></section>;
  if (!record || record.candidate.status !== "draft") {
    return <section className="state-card" role="alert"><h1>Entwurf nicht verfügbar</h1><p>Der Entwurf ist nicht vorhanden, bereits abgeschlossen oder nicht zugänglich.</p><button type="button" className="primary-button" onClick={() => navigate("/documents")}>Zu den Dokumenten</button></section>;
  }

  const payload = parseDraft();
  const start = payload?.start_time && typeof payload.start_time === "object" && !Array.isArray(payload.start_time) ? payload.start_time as Record<string, unknown> : {};
  return (
    <section className="form-card candidate-review" aria-labelledby="candidate-review-title">
      <div className="page-heading"><div><p className="eyebrow">Maschineller Entwurf · Prüfung offen</p><h1 id="candidate-review-title">Ereignis kontrollieren</h1><p className="muted">Quelle: {record.document.originalFileName}</p></div><button type="button" className="link-button" onClick={() => navigate("/documents")}>Zurück</button></div>
      {message ? <div className="error-summary" role="status"><p>{message}</p></div> : null}
      <div className="candidate-review-layout">
        <div>
          <div className="field-grid">
            <div className="field"><label htmlFor="candidate-type">Ereignisart</label><select id="candidate-type" value={String(payload?.event_type_code ?? "")} onChange={(event) => updateCore("event_type_code", event.target.value)}>{(Object.keys(eventTypeLabels) as EventTypeCode[]).map((code) => <option key={code} value={code}>{eventTypeLabels[code]}</option>)}</select></div>
            <div className="field"><label htmlFor="candidate-start">Startdatum *</label><input id="candidate-start" type="date" value={typeof start.local_date === "string" ? start.local_date : ""} onChange={(event) => updateStartDate(event.target.value)} /></div>
          </div>
          <div className="field"><label htmlFor="candidate-title">Titel *</label><input id="candidate-title" value={typeof payload?.title === "string" ? payload.title : ""} onChange={(event) => updateCore("title", event.target.value)} /></div>
          <div className="field"><label htmlFor="candidate-payload">Vollständiger geprüfter Ereignisstand</label><textarea id="candidate-payload" rows={18} value={draft} onChange={(event) => { setDraft(event.target.value); setDirty(true); setMessage(null); }} aria-describedby="candidate-payload-hint" /><p id="candidate-payload-hint" className="field-hint">Alle gemeinsamen, typspezifischen und wiederholbaren Felder einschließlich <code>segments</code> können hier ergänzt, entfernt und neu geordnet werden.</p></div>
          <div className="form-actions"><button type="button" className="secondary-button" onClick={() => void save()} disabled={isSaving}>{isSaving ? "Wird gespeichert …" : "Korrekturen speichern"}</button><button type="button" className="primary-button" onClick={() => void confirm()} disabled={isSaving}>Ereignis bestätigen</button><button type="button" className="link-button destructive-link" onClick={() => void discard()} disabled={isSaving}>Entwurf verwerfen</button></div>
        </div>
        <aside className="candidate-evidence" aria-labelledby="candidate-evidence-title"><div className="section-heading"><div><p className="eyebrow">Herkunft und Unsicherheit</p><h2 id="candidate-evidence-title">Erkannte Felder</h2></div><button type="button" className="secondary-button" onClick={() => void openOriginal()}>Original öffnen</button></div>
          {record.candidate.warnings.length ? <ul className="candidate-warning-list">{record.candidate.warnings.map((warning, index) => <li key={`${warning.code}-${index}`}><strong>{warning.severity === "blocking" ? "Blockierend: " : "Prüfen: "}</strong>{warning.message}</li>)}</ul> : null}
          <ul className="candidate-field-list">{record.candidate.fields.map((field) => <li key={`${field.fieldPath}:${field.occurrenceKey}`}><strong>{field.fieldPath}{field.occurrenceKey ? ` · ${field.occurrenceKey}` : ""}</strong><span>{candidateFieldSummary(field)}</span><span className="muted">{field.provenance === "explicit" ? "Im Original" : field.provenance === "inferred" ? "Abgeleitet – bitte prüfen" : "Unbekannt"}{field.confidence === null ? "" : ` · ${Math.round(field.confidence * 100)} %`}</span>{field.sourceLocator.map((locator, index) => <small key={`${locator.sourceHint}-${index}`}>{locator.pageNumber ? `Seite ${locator.pageNumber}: ` : ""}{locator.sourceHint}</small>)}</li>)}</ul>
          {originalUrl ? <a className="secondary-button download-link" href={originalUrl} download={record.document.originalFileName}>Original herunterladen</a> : null}
        </aside>
      </div>
    </section>
  );
}
