import { eventTypeLabels } from "../travel/format";
import type { EventTypeCode, LocationInput } from "../travel/types";
import {
  InputField,
  LocationFields,
  SegmentFields,
  TimeFields,
  blankLocation,
  blankTime,
  typeFieldDefinitions,
  updateLocationField,
  updateTimeField,
  type FormDraft,
  type SegmentDraft
} from "./TravelItemFormPage";

type Props = {
  draft: FormDraft;
  onChange: (draft: FormDraft) => void;
};

function newSegment(date: string): SegmentDraft {
  return {
    startLocation: blankLocation(),
    endLocation: blankLocation(),
    departure: blankTime(date),
    arrival: blankTime(date),
    details: {}
  };
}

export function CandidateTravelItemEditor({ draft, onChange }: Props) {
  const set = (next: FormDraft) => onChange(next);
  const updateField = (key: keyof FormDraft, value: string) => set({ ...draft, [key]: value } as FormDraft);
  const updateLocation = (key: "mainLocation" | "startLocation" | "endLocation") =>
    (field: keyof LocationInput, value: string) => set(updateLocationField(draft, key, field, value));
  const updateTime = (key: "start" | "end") =>
    (field: Parameters<typeof updateTimeField>[2], value: string) => set(updateTimeField(draft, key, field, value));
  const updateSegment = (index: number, next: SegmentDraft) => set({ ...draft, segments: draft.segments.map((segment, candidateIndex) => candidateIndex === index ? next : segment) });
  const moveSegment = (index: number, direction: -1 | 1) => {
    const segments = [...draft.segments];
    const target = index + direction;
    if (target < 0 || target >= segments.length) return;
    [segments[index], segments[target]] = [segments[target], segments[index]];
    set({ ...draft, segments });
  };
  const addSegments = () => set({
    ...draft,
    segments: draft.segments.length >= 2
      ? [...draft.segments, newSegment(draft.start.date)]
      : [newSegment(draft.start.date), newSegment(draft.start.date)]
  });
  const isTransport = ["flight", "rail", "bus"].includes(draft.eventTypeCode);
  const changeEventType = (eventTypeCode: EventTypeCode) => {
    const nextIsTransport = ["flight", "rail", "bus"].includes(eventTypeCode);
    set({ ...draft, eventTypeCode, typeFields: {}, segments: nextIsTransport ? draft.segments : [] });
  };

  return (
    <div className="candidate-structured-editor">
      <div className="field-grid">
        <div className="field">
          <label htmlFor="candidate-type">Ereignisart</label>
          <select id="candidate-type" value={draft.eventTypeCode} onChange={(event) => changeEventType(event.target.value as EventTypeCode)}>
            {(Object.keys(eventTypeLabels) as EventTypeCode[]).map((code) => <option key={code} value={code}>{eventTypeLabels[code]}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="candidate-status">Buchungsstatus</label>
          <select id="candidate-status" value={draft.bookingStatus} onChange={(event) => updateField("bookingStatus", event.target.value)}>
            <option value="confirmed">Bestätigt</option>
            <option value="cancelled">Storniert</option>
            <option value="unknown">Unbekannt</option>
          </select>
        </div>
      </div>
      <InputField id="candidate-title" label="Titel" value={draft.title} required onChange={(value) => updateField("title", value)} />
      <TimeFields idPrefix="candidate-start" label="Beginn *" value={draft.start} onChange={updateTime("start")} />
      <details open>
        <summary>Optionales Ende</summary>
        <TimeFields idPrefix="candidate-end" label="Ende" value={draft.end} required={false} onChange={updateTime("end")} />
      </details>
      <details open>
        <summary>Zentrale Orte und Verbindungen</summary>
        <LocationFields idPrefix="candidate-main-location" label="Hauptort" value={draft.mainLocation} onChange={updateLocation("mainLocation")} />
        <LocationFields idPrefix="candidate-start-location" label="Startort" value={draft.startLocation} onChange={updateLocation("startLocation")} />
        <LocationFields idPrefix="candidate-end-location" label="Zielort" value={draft.endLocation} onChange={updateLocation("endLocation")} />
      </details>
      <details>
        <summary>Buchungs- und Anbieterdaten</summary>
        <div className="field-grid">
          <InputField id="candidate-provider" label="Anbieter / Betreiber / Veranstalter" value={draft.providerName} onChange={(value) => updateField("providerName", value)} />
          <InputField id="candidate-platform" label="Vermittler / Buchungsplattform" value={draft.bookingPlatformName} onChange={(value) => updateField("bookingPlatformName", value)} />
          <InputField id="candidate-booking-date" label="Buchungsdatum" type="date" value={draft.bookingDate} onChange={(value) => updateField("bookingDate", value)} />
          <InputField id="candidate-management-url" label="Buchungs-, Check-in- oder Verwaltungslink" type="url" value={draft.managementUrl} onChange={(value) => updateField("managementUrl", value)} />
        </div>
        <InputField id="candidate-references" label="Buchungs-/Reservierungs-/Ticketnummern (eine pro Zeile, optional mit art:value)" multiline value={draft.references} onChange={(value) => updateField("references", value)} />
        <InputField id="candidate-travelers" label="Reisende oder Gäste (eine Person pro Zeile)" multiline value={draft.travelers} onChange={(value) => updateField("travelers", value)} />
        <InputField id="candidate-contacts" label="Anbieterkontakte (Rolle | Telefon | E-Mail | Website)" multiline value={draft.providerContacts} onChange={(value) => updateField("providerContacts", value)} />
      </details>
      <details>
        <summary>Preise und Bedingungen</summary>
        <div className="field-grid">
          <InputField id="candidate-total-price" label="Gesamtpreis" value={draft.totalPrice} onChange={(value) => updateField("totalPrice", value)} />
          <InputField id="candidate-currency" label="Währung (ISO 4217)" value={draft.currency} onChange={(value) => updateField("currency", value)} />
          <InputField id="candidate-paid" label="Bereits bezahlt" value={draft.paid} onChange={(value) => updateField("paid", value)} />
          <InputField id="candidate-outstanding" label="Noch offen" value={draft.outstanding} onChange={(value) => updateField("outstanding", value)} />
          <InputField id="candidate-taxes" label="Steuern und Gebühren" value={draft.taxesAndFees} onChange={(value) => updateField("taxesAndFees", value)} />
          <InputField id="candidate-payment-status" label="Zahlungsstatus" value={draft.paymentStatus} onChange={(value) => updateField("paymentStatus", value)} />
          <InputField id="candidate-payment-method" label="Zahlungsart (höchstens maskiert)" value={draft.paymentMethodMasked} onChange={(value) => updateField("paymentMethodMasked", value)} />
        </div>
        <TimeFields idPrefix="candidate-cancellation-deadline" label="Stornierungsfrist (optional)" value={draft.cancellationDeadline} required={false} onChange={(field, value) => set(updateTimeField(draft, "cancellationDeadline", field, value))} />
        <InputField id="candidate-cancellation" label="Stornierungsfrist und Bedingungen" multiline value={draft.cancellationConditions} onChange={(value) => updateField("cancellationConditions", value)} />
      </details>
      {isTransport ? (
        <details open>
          <summary>Teilstrecken</summary>
          <p className="field-hint">Für Flug, Bahn und Bus können mindestens zwei geordnete Teilstrecken erfasst werden.</p>
          <button id="candidate-segments-add" type="button" className="secondary-button" onClick={addSegments}>Teilstrecken hinzufügen</button>
          {draft.segments.map((segment, index) => (
            <SegmentFields
              key={segment.id ?? `candidate-segment-${index}`}
              segment={segment}
              index={index}
              onChange={(next) => updateSegment(index, next)}
              onMove={(direction) => moveSegment(index, direction)}
              onRemove={() => set({ ...draft, segments: draft.segments.filter((_, candidateIndex) => candidateIndex !== index) })}
              canMoveUp={index > 0}
              canMoveDown={index < draft.segments.length - 1}
            />
          ))}
        </details>
      ) : null}
      <details open>
        <summary>{eventTypeLabels[draft.eventTypeCode]} – weitere Angaben</summary>
        <div className="field-grid">
          {typeFieldDefinitions[draft.eventTypeCode].map((field) => (
            <InputField key={field.key} id={`candidate-type-${field.key}`} label={field.label} multiline={field.multiline} value={draft.typeFields[field.key] ?? ""} onChange={(value) => set({ ...draft, typeFields: { ...draft.typeFields, [field.key]: value } })} />
          ))}
        </div>
      </details>
      <details>
        <summary>Notizen und zusätzliche Angaben</summary>
        <InputField id="candidate-notes" label="Freie Notizen" multiline value={draft.notes} onChange={(value) => updateField("notes", value)} />
        <InputField id="candidate-attributes" label="Zusätzliche Anbieterangaben (label=value|Einheit, eine pro Zeile)" multiline value={draft.additionalAttributes} onChange={(value) => updateField("additionalAttributes", value)} />
      </details>
    </div>
  );
}
