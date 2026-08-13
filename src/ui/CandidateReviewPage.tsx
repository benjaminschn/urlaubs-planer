import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  candidateCorrections,
  candidateToCanonicalPayload,
  canonicalPayloadToTravelItemPayload,
  travelItemPayloadToCanonicalPayload,
  validateCanonicalPayload
} from "../documents/candidate-review";
import { candidateFieldSummary } from "../documents/extraction";
import { useDocuments } from "../documents/context";
import { useNavigationGuard, useRouter } from "../router/HashRouter";
import { candidateRouteFromPath } from "../router/routes";
import { validateTravelItemPayload } from "../travel/validation";
import type { CandidateMutationResult } from "../documents/types";
import { draftToPayload, payloadToDraft, type FormDraft } from "./TravelItemFormPage";
import { CandidateTravelItemEditor } from "./CandidateTravelItemEditor";
import { formatFieldPath } from "./field-labels";

function errorFieldId(key: string): string {
  if (key === "title") return "candidate-title";
  if (key === "startTime") return "candidate-start-date";
  if (key === "endTime") return "candidate-end-date";
  if (key === "managementUrl") return "candidate-management-url";
  if (key === "bookingDate") return "candidate-booking-date";
  if (key === "cancellationDeadline") return "candidate-cancellation-deadline-date";
  if (key === "Hauptort") return "candidate-main-location-name";
  if (key === "Startort") return "candidate-start-location-name";
  if (key === "Zielort") return "candidate-end-location-name";
  const segment = key.match(/^segments\.(\d+)\.(departure|arrival)/);
  if (segment) return `segment-${segment[1]}-${segment[2]}-date`;
  if (key.startsWith("segments")) return "candidate-segments-add";
  return "candidate-title";
}

export function CandidateReviewPage() {
  const { route, navigate } = useRouter();
  const { state, getCandidate, download, saveCandidateReview, discardCandidate, confirmCandidate } = useDocuments();
  const candidateRoute = candidateRouteFromPath(route.path);
  const record = candidateRoute ? getCandidate(candidateRoute.candidateId) : null;
  const candidate = record?.candidate ?? null;
  const initialPayload = useMemo(
    () => candidate ? candidateToCanonicalPayload(candidate) : null,
    [candidate]
  );
  const initialDraft = useMemo(() => initialPayload ? payloadToDraft(canonicalPayloadToTravelItemPayload(initialPayload)) : null, [initialPayload]);
  const [draft, setDraft] = useState<FormDraft | null>(initialDraft);
  const [dirty, setDirty] = useState(false);
  const [baseVersion, setBaseVersion] = useState<number | null>(candidate?.version ?? null);
  const [basePayload, setBasePayload] = useState<Record<string, unknown> | null>(initialPayload);
  const [message, setMessage] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  const saveButtonRef = useRef<HTMLButtonElement | null>(null);
  const confirmationKey = useRef(crypto.randomUUID());
  const hasExternalConflict = dirty && baseVersion !== null && candidate !== null && candidate.version !== baseVersion;

  useNavigationGuard(dirty, "Ungespeicherte Änderungen verwerfen und diese Seite verlassen?");

  useEffect(() => {
    if (!dirty && initialDraft && candidate && (baseVersion === null || candidate.version >= baseVersion)) {
      setDraft(initialDraft);
      setBaseVersion(candidate.version);
      setBasePayload(initialPayload);
    }
  }, [baseVersion, candidate, dirty, initialDraft, initialPayload]);

  useEffect(() => {
    if (hasExternalConflict) setMessage("Der Entwurf wurde zwischenzeitlich geändert. Ihre Eingaben bleiben sichtbar; laden Sie die Seite neu, um den Serverstand zu übernehmen.");
  }, [hasExternalConflict]);

  useEffect(() => {
    const marked = document.querySelectorAll<HTMLElement>("[data-candidate-invalid]");
    marked.forEach((element) => {
      element.removeAttribute("data-candidate-invalid");
      element.removeAttribute("aria-invalid");
      element.removeAttribute("aria-describedby");
    });
    for (const key of Object.keys(errors)) {
      const element = document.getElementById(errorFieldId(key));
      if (!element) continue;
      element.setAttribute("data-candidate-invalid", "true");
      element.setAttribute("aria-invalid", "true");
      element.setAttribute("aria-describedby", "candidate-validation-summary");
    }
  }, [errors]);

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

  function validate(): Record<string, unknown> | null {
    if (!draft) return null;
    const travelPayload = draftToPayload(draft);
    const nextErrors = validateTravelItemPayload(travelPayload);
    const canonical = travelItemPayloadToCanonicalPayload(travelPayload);
    for (const [index, error] of validateCanonicalPayload(canonical).entries()) nextErrors[`canonical.${index}`] = error;
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      setMessage("Bitte korrigieren Sie die markierten Angaben, bevor Sie den Entwurf speichern.");
      window.setTimeout(() => document.getElementById(errorFieldId(Object.keys(nextErrors)[0]))?.focus(), 0);
      return null;
    }
    setMessage(null);
    return canonical;
  }

  async function save(): Promise<CandidateMutationResult | null> {
    if (!record || baseVersion === null || !basePayload) return null;
    if (hasExternalConflict) {
      setMessage("Der Entwurf wurde zwischenzeitlich geändert. Speichern wurde zum Schutz der anderen Änderung blockiert.");
      return null;
    }
    const payload = validate();
    if (!payload) return null;
    const previous = travelItemPayloadToCanonicalPayload(canonicalPayloadToTravelItemPayload(basePayload));
    const corrections = candidateCorrections(previous, payload);
    setIsSaving(true);
    const result = await saveCandidateReview(record.candidate.id, baseVersion, payload, corrections);
    setIsSaving(false);
    if (result.kind === "updated") {
      setDirty(false);
      setBaseVersion(result.version);
      setBasePayload(payload);
      setMessage("Korrektur gespeichert. Die geänderten Felder bleiben einzeln nachvollziehbar.");
      return result;
    }
    setMessage(result.kind === "conflict" ? `${result.message} Ihre Eingaben bleiben sichtbar; laden Sie die Seite neu, um den Serverstand zu übernehmen.` : "message" in result ? result.message : "Korrektur konnte nicht gespeichert werden.");
    return result;
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await save();
  }

  async function confirm() {
    if (!record) return;
    const payload = validate();
    if (!payload) return;
    if (hasExternalConflict || baseVersion === null) {
      setMessage("Der Entwurf wurde zwischenzeitlich geändert. Bestätigen wurde zum Schutz der anderen Änderung blockiert.");
      return;
    }
    let expectedVersion = baseVersion;
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

  function leaveReview() {
    navigate("/documents");
  }

  if (state.status === "loading" || state.status === "idle") return <section className="state-card"><p>Entwurf wird geladen …</p></section>;
  if (!record || record.candidate.status !== "draft" || !draft) {
    return (
      <section className="state-card" role="alert">
        <h1>Entwurf nicht verfügbar</h1>
        <p>Der Entwurf ist nicht vorhanden, bereits abgeschlossen oder nicht zugänglich.</p>
        <button type="button" className="primary-button state-action" onClick={() => navigate("/documents")}>Zu den Dokumenten</button>
      </section>
    );
  }

  return (
    <section className="form-card candidate-review" aria-labelledby="candidate-review-title">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Maschineller Entwurf · Prüfung offen</p>
          <h1 id="candidate-review-title">Ereignis kontrollieren</h1>
          <p className="muted stack-gap-sm">Quelle: {record.document.originalFileName}</p>
          <p className="field-hint" role="status">{dirty ? "Nicht gespeicherte Änderungen" : "Alle Änderungen gespeichert"}</p>
        </div>
        <button type="button" className="link-button" onClick={leaveReview}>Zurück</button>
      </div>
      {message ? <div className="error-summary" role="status"><p>{message}</p></div> : null}
      {Object.keys(errors).length > 0 ? (
        <div id="candidate-validation-summary" className="error-summary" role="alert" aria-labelledby="candidate-validation-title">
          <p id="candidate-validation-title">Bitte prüfen Sie folgende Angaben:</p>
          <ul>{Object.entries(errors).map(([key, error]) => <li key={key}><button type="button" className="link-button" onClick={() => document.getElementById(errorFieldId(key))?.focus()}>{error}</button></li>)}</ul>
        </div>
      ) : null}
      <div className="candidate-review-layout">
        <form onSubmit={handleSave} noValidate>
          <CandidateTravelItemEditor draft={draft} onChange={(next) => {
            setDraft(next);
            setDirty(true);
            setErrors({});
            setMessage(null);
          }} />
          <div className="form-actions">
            <button ref={saveButtonRef} type="submit" className="secondary-button" disabled={isSaving} aria-busy={isSaving}>{isSaving ? "Wird gespeichert …" : "Korrekturen speichern"}</button>
            <button type="button" className="primary-button" onClick={() => void confirm()} disabled={isSaving}>Ereignis bestätigen</button>
            <button type="button" className="link-button destructive-link" onClick={() => void discard()} disabled={isSaving}>Entwurf verwerfen</button>
          </div>
        </form>
        <aside className="candidate-evidence" aria-labelledby="candidate-evidence-title">
          <div className="section-heading">
            <div><p className="eyebrow">Herkunft und Unsicherheit</p><h2 id="candidate-evidence-title">Erkannte Felder</h2></div>
            <button type="button" className="secondary-button" onClick={() => void openOriginal()}>Original öffnen</button>
          </div>
          {record.candidate.warnings.length ? (
            <ul className="candidate-warning-list">{record.candidate.warnings.map((warning, index) => <li key={`${warning.code}-${index}`}><strong>{warning.severity === "blocking" ? "Blockierend: " : "Prüfen: "}</strong>{warning.message}</li>)}</ul>
          ) : null}
          <ul className="candidate-field-list">
            {record.candidate.fields.map((field) => (
              <li key={`${field.fieldPath}:${field.occurrenceKey}`}>
                <strong>{formatFieldPath(field.fieldPath)}{field.occurrenceKey ? ` · ${field.occurrenceKey}` : ""}</strong>
                <span>{candidateFieldSummary(field)}</span>
                <span className="muted">{field.provenance === "explicit" ? "Im Original" : field.provenance === "inferred" ? "Abgeleitet – bitte prüfen" : "Unbekannt"}{field.confidence === null ? "" : ` · ${Math.round(field.confidence * 100)} %`}</span>
                {field.sourceLocator.map((locator, index) => <small key={`${locator.sourceHint}-${index}`}>{locator.pageNumber ? `Seite ${locator.pageNumber}: ` : ""}{locator.sourceHint}</small>)}
              </li>
            ))}
          </ul>
          {originalUrl ? <a className="secondary-button download-link" href={originalUrl} download={record.document.originalFileName}>Original herunterladen</a> : null}
        </aside>
      </div>
    </section>
  );
}
