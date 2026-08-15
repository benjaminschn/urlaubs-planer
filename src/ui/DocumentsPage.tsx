import { useEffect, useRef, useState } from "react";
import { useDocuments } from "../documents/context";
import {
  MAX_DOCUMENT_BYTES,
  MAX_SELECTION_BYTES,
  MAX_SELECTION_FILES
} from "../documents/types";
import type { Document } from "../documents/types";
import { documentErrorMessage, isInlineDocumentType, validateDocumentSelection } from "../documents/validation";
import { candidateStartDate, candidateTitle, candidateWarnings, extractionErrorMessage, extractionStatusLabels } from "../documents/extraction";
import { useRouter } from "../router/HashRouter";
import { eventTypeLabels, formatLocalDate } from "../travel/format";
import type { EventTypeCode } from "../travel/types";

type QueueEntry = {
  id: string;
  file: File;
  idempotencyKey: string;
  batchKey: string;
  batchFileCount: number;
  batchTotalBytes: number;
  status: "selected" | "uploading" | "available" | "failed";
  message?: string;
  code?: string;
};

type Preview = {
  documentId: string;
  url: string;
  fileName: string;
  contentType: string;
};

const statusLabels: Record<Document["status"], string> = {
  uploading: "Wird hochgeladen",
  uploaded: "Wird geprüft",
  verifying: "Wird sicher geprüft",
  verification_pending: "Prüfung ausstehend",
  available: "Verfügbar",
  upload_failed: "Upload fehlgeschlagen",
  unsupported: "Nicht unterstützt",
  invalid: "Sicher abgelehnt",
  deleted: "Gelöscht"
};

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function queueStatusLabel(status: QueueEntry["status"]): string {
  return status === "selected" ? "Ausgewählt" : status === "uploading" ? "Wird hochgeladen" : status === "available" ? "Verfügbar" : "Fehlgeschlagen";
}

export function DocumentsPage() {
  const { navigate } = useRouter();
  const { state, isRefreshing, isUploading, upload, retryVerification, download, startExtraction } = useDocuments();
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview.url);
  }, [preview]);

  async function runQueue(entries: QueueEntry[]) {
    let nextIndex = 0;
    async function worker() {
      while (nextIndex < entries.length) {
        const entry = entries[nextIndex];
        nextIndex += 1;
        setQueue((current) => current.map((candidate) => candidate.id === entry.id ? { ...candidate, status: "uploading" } : candidate));
        const result = await upload({
          file: entry.file,
          idempotencyKey: entry.idempotencyKey,
          batchKey: entry.batchKey,
          batchFileCount: entry.batchFileCount,
          batchTotalBytes: entry.batchTotalBytes
        });
        if (result.kind === "available") {
          setQueue((current) => current.map((candidate) => candidate.id === entry.id ? { ...candidate, status: "available" } : candidate));
        } else {
          setQueue((current) => current.map((candidate) => candidate.id === entry.id ? { ...candidate, status: "failed", message: result.message, code: "code" in result ? result.code : undefined } : candidate));
        }
      }
    }
    await Promise.all([worker(), worker()]);
  }

  function handleSelection(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) return;
    const selectionError = validateDocumentSelection(files);
    if (selectionError) {
      setMessage(selectionError);
      return;
    }
    setMessage(null);
    const batchKey = crypto.randomUUID();
    const batchTotalBytes = files.reduce((total, file) => total + file.size, 0);
    const entries = files.map((file, index) => ({
      id: `${batchKey}-${index}`,
      file,
      idempotencyKey: `${batchKey}-${index}`,
      batchKey,
      batchFileCount: files.length,
      batchTotalBytes,
      status: "selected" as const
    }));
    setQueue((current) => [...entries, ...current].slice(0, 10));
    void runQueue(entries);
  }

  async function openDocument(document: Document) {
    const result = await download(document.id);
    if (result.kind !== "downloaded") {
      setMessage(result.message);
      return;
    }
    setPreview((current) => {
      if (current) URL.revokeObjectURL(current.url);
      return {
        documentId: document.id,
        url: URL.createObjectURL(result.blob),
        fileName: result.fileName,
        contentType: result.contentType
      };
    });
  }

  async function processDocument(document: Document) {
    const result = await startExtraction(document.id);
    if (result.kind !== "accepted") setMessage(result.message);
  }

  async function retryDocumentVerification(document: Document) {
    const result = await retryVerification(document.id);
    if (result.kind !== "available") setMessage(result.message);
  }

  function newestRun(documentId: string) {
    return state.runs.find((run) => run.documentId === documentId) ?? null;
  }

  if (state.status === "disabled") {
    return <section className="state-card protected-card" aria-labelledby="documents-title"><p>Dokumente</p><h1 id="documents-title">Dokumente sind derzeit nicht verfügbar.</h1></section>;
  }

  return (
    <>
      <section className="documents-header" aria-labelledby="documents-title">
        <div>
          <p className="eyebrow">Private Originale</p>
          <h1 id="documents-title">Dokumente</h1>
          <p className="muted">Bis zu fünf Dateien auswählen. Pro Datei gelten 20 MiB, für eine Auswahl 50 MiB.</p>
        </div>
        <div className="document-upload-action">
          <button className="primary-button" type="button" onClick={() => inputRef.current?.click()} disabled={isUploading}>
            {isUploading ? "Upload läuft …" : "Dateien auswählen"}
          </button>
          <input
            ref={inputRef}
            className="visually-hidden"
            type="file"
            multiple
            accept=".pdf,.jpg,.jpeg,.png,.webp,.gif,.docx,.xlsx,.pptx,.eml,.txt,.text,.csv,application/pdf,image/jpeg,image/png,image/webp,image/gif,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.presentationml.presentation,message/rfc822,text/plain,text/csv"
            onChange={handleSelection}
            aria-label="Dateien auswählen"
          />
        </div>
      </section>
      <p className="muted document-note">Originale werden erst nach Größen-, Signatur-, Struktur- und Sicherheitsprüfung für beide Mitglieder freigegeben. Die Verarbeitung wird nur ausdrücklich für ein freigegebenes Original gestartet; Vorschläge erscheinen nie automatisch in der Timeline.</p>
      {message ? <div className="error-summary" role="alert"><p>{message}</p></div> : null}
      {queue.length > 0 ? (
        <section className="document-queue" aria-labelledby="queue-title">
          <div className="section-heading"><div><p className="eyebrow">Upload</p><h2 id="queue-title">Aktuelle Auswahl</h2></div></div>
          <ul>
            {queue.map((entry) => (
              <li key={entry.id} className="document-queue-item">
                <div><strong>{entry.file.name}</strong><span className="muted">{formatBytes(entry.file.size)} · {queueStatusLabel(entry.status)}</span></div>
                <div>
                  {entry.message ? <p className="status-text">{entry.message}</p> : null}
                  {entry.status === "failed" && entry.code === "upload_failed" ? <button className="link-button" type="button" onClick={() => void runQueue([entry])}>Erneut versuchen</button> : null}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {state.message ? <div className="error-summary" role="alert"><p>{state.message}</p></div> : null}
      {state.status === "loading" ? <section className="state-card" aria-live="polite"><p>Dokumente werden geladen …</p></section> : null}
      {state.status === "error" ? <section className="state-card" role="alert"><h2>Dokumente konnten nicht geladen werden</h2><p>{state.message}</p></section> : null}
      {state.status === "ready" && state.documents.length === 0 ? (
        <section className="state-card document-empty" aria-labelledby="documents-empty-title">
          <p className="eyebrow">Dokumente</p>
          <h2 id="documents-empty-title">Noch keine Dokumente</h2>
          <p>Hochgeladene Originale erscheinen hier nach der serverseitigen Prüfung.</p>
        </section>
      ) : null}
      {state.status === "ready" && state.documents.length > 0 ? (
        <section className="document-list" aria-labelledby="document-list-title">
          <div className="section-heading"><div><p className="eyebrow">Gespeichert</p><h2 id="document-list-title">Originaldokumente</h2></div>{isRefreshing ? <p className="muted">Wird aktualisiert …</p> : null}</div>
          <ul>
            {state.documents.map((document) => (
              <li key={document.id}>
                {(() => {
                  const run = newestRun(document.id);
                  const isActive = run?.status === "queued" || run?.status === "processing";
                  return <>
                <article className="document-card">
                  <div className="document-card-main">
                    <p className="eyebrow">{document.detectedContentType ?? document.reportedContentType ?? "Datei"}</p>
                    <h3>{document.originalFileName}</h3>
                    <p className="muted">{formatBytes(document.byteSize)} · {statusLabels[document.status]}</p>
                    {document.errorCode ? <p className="status-text">{documentErrorMessage(document.errorCode)}</p> : null}
                  </div>
                  <div className="document-card-actions">
                    {document.status === "available" ? <button className="secondary-button" type="button" onClick={() => void openDocument(document)}>Original öffnen</button> : null}
                    {document.status === "verification_pending" || document.status === "verifying" ? <button className="secondary-button" type="button" onClick={() => void retryDocumentVerification(document)}>Sicherheitsprüfung erneut versuchen</button> : null}
                    {document.status === "available" ? <button className="primary-button" type="button" onClick={() => void processDocument(document)} disabled={isActive}>{isActive ? "Verarbeitung läuft …" : "Verarbeitung starten"}</button> : null}
                  </div>
                </article>
                {run ? (
                  <section className="extraction-run" aria-label={`Verarbeitung für ${document.originalFileName}`}>
                    <p className="status-text" role="status">{extractionStatusLabels[run.status]}</p>
                    {run.errorCode ? <p className="status-text">{extractionErrorMessage(run.errorCode)}</p> : null}
                    {run.warnings.length > 0 ? <ul className="candidate-warning-list">{run.warnings.map((warning, index) => <li key={`${warning.code}-${index}`}>{warning.message}</li>)}</ul> : null}
                    {run.status === "succeeded" && run.candidates.length === 0 ? <p className="muted">Keine passenden Reiseereignisse erkannt. Das Original bleibt verfügbar.</p> : null}
                    {run.candidates.length > 0 ? (
                      <div className="candidate-list">
                        <p className="eyebrow">Unbestätigte Vorschläge</p>
                        <ul>
                          {run.candidates.map((candidate) => {
                            const typeCode = candidate.proposedEventTypeCode as EventTypeCode;
                            const typeLabel = eventTypeLabels[typeCode] ?? candidate.proposedEventTypeCode;
                            const start = candidateStartDate(candidate);
                            const statusLabel =
                              candidate.status === "draft"
                                ? "Prüfung offen"
                                : candidate.status === "confirmed"
                                  ? "Bestätigt"
                                  : candidate.status === "discarded"
                                    ? "Verworfen"
                                    : "Ersetzt";
                            return (
                            <li key={candidate.id}>
                              <strong>{candidateTitle(candidate)}</strong>
                              <span className="muted">
                                {typeLabel}
                                {" · "}
                                {start ? formatLocalDate(start) : "Startdatum unbekannt"}
                                {" · "}
                                {statusLabel}
                              </span>
                              {candidateWarnings(run, candidate).length > 0 ? <ul className="candidate-warning-list">{candidateWarnings(run, candidate).map((warning, index) => <li key={`${warning.code}-${index}`}>{warning.message}</li>)}</ul> : null}
                              {candidate.status === "draft" ? <button type="button" className="secondary-button" onClick={() => navigate(`/candidates/${candidate.id}`)}>Jetzt kontrollieren</button> : null}
                              {candidate.status === "confirmed" && candidate.confirmedTravelItemId ? <button type="button" className="secondary-button" onClick={() => navigate(`/events/${candidate.confirmedTravelItemId}`)}>Bestätigtes Ereignis öffnen</button> : null}
                            </li>
                            );
                          })}
                        </ul>
                        <p className="muted">Die Vorschläge sind noch nicht bestätigt und erscheinen nicht in der Timeline.</p>
                      </div>
                    ) : null}
                  </section>
                ) : null}
                  </>;
                })()}
                {preview?.documentId === document.id ? (
                  <div className="document-preview" aria-label={`${document.originalFileName} Vorschau`}>
                    {isInlineDocumentType(preview.contentType) ? <img src={preview.url} alt={`Vorschau von ${preview.fileName}`} /> : <p className="muted">Für dieses Format wird keine aktive Inline-Vorschau ausgeführt.</p>}
                    <a className="secondary-button download-link" href={preview.url} download={preview.fileName}>Original herunterladen</a>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <p className="document-limits muted">Servergrenzen: max. {MAX_SELECTION_FILES} Dateien je Auswahl · {formatBytes(MAX_DOCUMENT_BYTES)} je Original · {formatBytes(MAX_SELECTION_BYTES)} je Auswahl · 2 parallele Uploads · 50 nicht gelöschte Originale je Reise.</p>
    </>
  );
}
