import { useEffect, useRef, useState } from "react";
import { useDocuments } from "../documents/context";
import { useRouter } from "../router/HashRouter";
import { useTravelItems } from "../travel/context";
import { createIdempotencyKey, eventTypeClass, eventTypeLabels, formatLocalDate, formatTimeRange } from "../travel/format";
import { travelItemRouteFromPath } from "../router/routes";
import type { Location, TravelItem } from "../travel/types";
import { formatFieldKey } from "./field-labels";

function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined || value === "") return true;
  if (Array.isArray(value)) return value.length === 0 || value.every(isEmptyValue);
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).every(isEmptyValue);
  }
  return false;
}

function RenderValue({ value }: { value: unknown }) {
  if (isEmptyValue(value)) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return <span>{String(value)}</span>;
  }
  if (Array.isArray(value)) {
    const entries = value.filter((entry) => !isEmptyValue(entry));
    if (entries.length === 0) return null;
    // Simple string/number lists as comma-separated text
    if (entries.every((entry) => typeof entry === "string" || typeof entry === "number")) {
      return <span>{entries.join(", ")}</span>;
    }
    return (
      <ul className="detail-list">
        {entries.map((entry, index) => (
          <li key={index}>
            <RenderValue value={entry} />
          </li>
        ))}
      </ul>
    );
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, entry]) => !isEmptyValue(entry));
    if (entries.length === 0) return null;
    return (
      <dl className="detail-list">
        {entries.map(([key, entry]) => (
          <div key={key}>
            <dt>{formatFieldKey(key)}</dt>
            <dd>
              <RenderValue value={entry} />
            </dd>
          </div>
        ))}
      </dl>
    );
  }
  return null;
}

function LocationBlock({ label, location }: { label: string; location: Location | null }) {
  if (!location) return null;
  return (
    <div className="detail-block">
      <dt>{label}</dt>
      <dd>
        <strong>{location.name}</strong>
        {location.city || location.countryCode ? (
          <span>{[location.city, location.countryCode].filter(Boolean).join(", ")}</span>
        ) : null}
        {location.fullAddress ? <span>{location.fullAddress}</span> : null}
        {location.locationCode ? (
          <span>
            {location.locationCodeType ? `${location.locationCodeType}: ` : ""}
            {location.locationCode}
          </span>
        ) : null}
      </dd>
    </div>
  );
}

function TravelItemDetails({ item }: { item: TravelItem }) {
  const common = item.commonDetails;
  const optionalPayload = {
    ...common.price,
    references: common.references,
    travelers: common.travelers,
    providerContacts: common.providerContacts,
    cancellationConditions: common.cancellationConditions,
    additionalAttributes: common.additionalAttributes,
    ...item.typeDetails
  };
  const hasOptional = !isEmptyValue(optionalPayload);

  return (
    <>
      <dl className="detail-grid">
        <div className="detail-block">
          <dt>Beginn</dt>
          <dd>{formatTimeRange(item.startTime, item.endTime)}</dd>
        </div>
        <LocationBlock label="Hauptort" location={item.locations.main} />
        <LocationBlock label="Startort" location={item.locations.start} />
        <LocationBlock label="Zielort" location={item.locations.end} />
        {common.providerName ? (
          <div className="detail-block">
            <dt>Anbieter</dt>
            <dd>{common.providerName}</dd>
          </div>
        ) : null}
        {common.bookingPlatformName ? (
          <div className="detail-block">
            <dt>Buchungsplattform</dt>
            <dd>{common.bookingPlatformName}</dd>
          </div>
        ) : null}
        {common.bookingDate ? (
          <div className="detail-block">
            <dt>Buchungsdatum</dt>
            <dd>{formatLocalDate(common.bookingDate)}</dd>
          </div>
        ) : null}
        {common.managementUrl ? (
          <div className="detail-block">
            <dt>Verwaltungslink</dt>
            <dd>
              <a href={common.managementUrl} rel="noreferrer">
                Link öffnen
              </a>
            </dd>
          </div>
        ) : null}
      </dl>
      {item.segments.length > 0 ? (
        <section className="detail-section" aria-labelledby="segments-title">
          <h2 id="segments-title">Teilstrecken</h2>
          <ol className="segment-list">
            {item.segments.map((segment) => (
              <li key={segment.id} className="segment-read-card">
                <p className="eyebrow">Teilstrecke {segment.sequenceNumber}</p>
                <h3>
                  {segment.startLocation.name} → {segment.endLocation.name}
                </h3>
                <p>{formatTimeRange(segment.departureTime, segment.arrivalTime)}</p>
                <RenderValue value={segment.details} />
              </li>
            ))}
          </ol>
        </section>
      ) : null}
      {hasOptional ? (
        <section className="detail-section" aria-labelledby="optional-details-title">
          <h2 id="optional-details-title">Gespeicherte Angaben</h2>
          <RenderValue value={optionalPayload} />
        </section>
      ) : null}
      {common.notes ? (
        <section className="detail-section">
          <h2>Notizen</h2>
          <p className="preserved-text">{common.notes}</p>
        </section>
      ) : null}
    </>
  );
}

export function TravelItemDetailPage() {
  const { route, navigate } = useRouter();
  const itemRoute = travelItemRouteFromPath(route.path);
  const { state, remove, isSaving, getItem } = useTravelItems();
  const { state: documentState, download } = useDocuments();
  const [showDelete, setShowDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sourceDownloads, setSourceDownloads] = useState<Record<string, { url: string; fileName: string }>>({});
  const sourceUrls = useRef<string[]>([]);
  const item = itemRoute?.kind === "detail" ? getItem(itemRoute.itemId) : null;

  useEffect(() => () => sourceUrls.current.forEach((url) => URL.revokeObjectURL(url)), []);

  if (state.status === "loading") {
    return (
      <section className="state-card">
        <p>Ereignis wird geladen …</p>
      </section>
    );
  }
  if (!itemRoute || itemRoute.kind !== "detail" || !item) {
    return (
      <section className="state-card" role="alert">
        <h1>Ereignis nicht gefunden</h1>
        <p>Das Ereignis ist nicht vorhanden oder nicht mehr zugänglich.</p>
        <button className="primary-button state-action" type="button" onClick={() => navigate("/app")}>
          Zur Timeline
        </button>
      </section>
    );
  }
  const selectedItem = item;

  async function handleDelete() {
    const result = await remove(selectedItem.id, selectedItem.version, createIdempotencyKey());
    if (result.kind === "deleted") {
      navigate("/app", { replace: true });
      return;
    }
    if (result.kind === "conflict") {
      setError("Das Ereignis wurde zwischenzeitlich geändert. Bitte laden Sie den neuen Stand und versuchen Sie es erneut.");
    } else if (result.kind === "validation" || result.kind === "limit" || result.kind === "forbidden") {
      setError(result.message);
    } else if (result.kind === "unavailable") {
      setError(result.message);
    } else {
      setError("Das Ereignis konnte nicht gelöscht werden.");
    }
    setShowDelete(false);
  }

  async function loadSource(documentId: string) {
    const result = await download(documentId);
    if (result.kind !== "downloaded") {
      setError(result.message);
      return;
    }
    const url = URL.createObjectURL(result.blob);
    sourceUrls.current.push(url);
    setSourceDownloads((current) => ({ ...current, [documentId]: { url, fileName: result.fileName } }));
  }

  const sourceDocuments = selectedItem.documentIds.flatMap((documentId) => {
    const document = documentState.documents.find((candidate) => candidate.id === documentId);
    return document ? [document] : [];
  });

  const statusLabel =
    selectedItem.bookingStatus === "cancelled"
      ? "Storniert"
      : selectedItem.bookingStatus === "confirmed"
        ? "Bestätigt"
        : "Buchungsstatus unbekannt";
  const statusClass =
    selectedItem.bookingStatus === "cancelled"
      ? "status-pill status-pill--cancelled"
      : selectedItem.bookingStatus === "confirmed"
        ? "status-pill status-pill--confirmed"
        : "status-pill";

  return (
    <section className="detail-page" aria-labelledby="travel-item-detail-title">
      <div className="page-heading">
        <div>
          <div className="timeline-card-meta">
            <span className={eventTypeClass(selectedItem.eventTypeCode)}>
              {eventTypeLabels[selectedItem.eventTypeCode]}
            </span>
            <span className={statusClass}>{statusLabel}</span>
          </div>
          <h1 id="travel-item-detail-title" className="detail-title">
            {selectedItem.title}
          </h1>
        </div>
        <button className="link-button" type="button" onClick={() => navigate("/app")}>
          Zurück zur Timeline
        </button>
      </div>
      {error ? (
        <div className="error-summary" role="alert">
          <p>{error}</p>
        </div>
      ) : null}
      <TravelItemDetails item={selectedItem} />
      {sourceDocuments.length > 0 ? (
        <section className="detail-section" aria-labelledby="source-documents-title">
          <h2 id="source-documents-title">Herkunftsdokumente</h2>
          <ul className="detail-list">
            {sourceDocuments.map((document) => (
              <li key={document.id}>
                <span>{document.originalFileName}</span>
                {sourceDownloads[document.id] ? (
                  <a
                    className="secondary-button download-link"
                    href={sourceDownloads[document.id].url}
                    download={sourceDownloads[document.id].fileName}
                  >
                    Original herunterladen
                  </a>
                ) : (
                  <button className="secondary-button" type="button" onClick={() => void loadSource(document.id)}>
                    Original laden
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <div className="detail-actions">
        <button className="secondary-button" type="button" onClick={() => navigate(`/events/${selectedItem.id}/edit`)}>
          Bearbeiten
        </button>
        <button className="danger-button" type="button" onClick={() => setShowDelete(true)}>
          Ereignis löschen
        </button>
      </div>
      {showDelete ? (
        <div className="dialog-backdrop" role="presentation">
          <section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-dialog-title">
            <h2 id="delete-dialog-title">Ereignis löschen?</h2>
            <p>
              Das Ereignis wird aus der normalen Timeline entfernt. Zugehörige Originaldokumente bleiben unabhängig
              davon erhalten.
            </p>
            <div className="detail-actions dialog-actions">
              <button className="secondary-button" type="button" onClick={() => setShowDelete(false)} disabled={isSaving}>
                Abbrechen
              </button>
              <button
                className="danger-button"
                type="button"
                onClick={() => void handleDelete()}
                disabled={isSaving}
                aria-busy={isSaving}
              >
                {isSaving ? "Ereignis wird gelöscht …" : "Endgültig löschen"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
