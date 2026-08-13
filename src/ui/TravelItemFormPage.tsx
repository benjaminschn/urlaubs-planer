import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useRouter } from "../router/HashRouter";
import { useTrip } from "../trip/context";
import { useTravelItems } from "../travel/context";
import { createIdempotencyKey } from "../travel/format";
import { makeDateOnlyTime, resolveExactLocalTime, validateTravelItemPayload } from "../travel/validation";
import type {
  BookingStatus,
  EventTypeCode,
  LocalTimeValue,
  LocationInput,
  ProviderContact,
  Reference,
  TravelItem,
  TravelItemPayload,
  TravelItemSegmentInput
} from "../travel/types";
import { eventTypeLabels } from "../travel/format";
import { travelItemRouteFromPath } from "../router/routes";

export type LocationDraft = LocationInput;

export type TimeDraft = {
  date: string;
  precision: LocalTimeValue["precision"];
  time: string;
  timeZone: string;
  offset: number | null;
};

export type SegmentDraft = {
  id?: string;
  startLocation: LocationDraft;
  endLocation: LocationDraft;
  departure: TimeDraft;
  arrival: TimeDraft;
  details: Record<string, string>;
};

export type FormDraft = {
  eventTypeCode: EventTypeCode;
  title: string;
  bookingStatus: BookingStatus;
  start: TimeDraft;
  end: TimeDraft;
  mainLocation: LocationDraft;
  startLocation: LocationDraft;
  endLocation: LocationDraft;
  providerName: string;
  bookingPlatformName: string;
  managementUrl: string;
  bookingDate: string;
  notes: string;
  references: string;
  travelers: string;
  providerContacts: string;
  totalPrice: string;
  currency: string;
  paid: string;
  outstanding: string;
  taxesAndFees: string;
  paymentStatus: string;
  paymentMethodMasked: string;
  cancellationDeadline: TimeDraft;
  cancellationConditions: string;
  additionalAttributes: string;
  typeFields: Record<string, string>;
  segments: SegmentDraft[];
};

type FieldDefinition = { key: string; label: string; multiline?: boolean };

export const typeFieldDefinitions: Record<EventTypeCode, FieldDefinition[]> = {
  accommodation: [
    { key: "accommodation_name", label: "Name der Unterkunft" },
    { key: "accommodation_type", label: "Art der Unterkunft" },
    { key: "check_in_date", label: "Check-in-Datum" },
    { key: "check_in_time_window", label: "Check-in-Uhrzeit oder Zeitfenster" },
    { key: "check_out_date", label: "Check-out-Datum" },
    { key: "check_out_time_window", label: "Check-out-Uhrzeit oder Zeitfenster" },
    { key: "nights", label: "Anzahl Nächte" },
    { key: "rooms", label: "Anzahl Zimmer" },
    { key: "guests", label: "Anzahl Gäste" },
    { key: "room_name", label: "Zimmer-/Apartmentbezeichnung" },
    { key: "room_number", label: "Zimmernummer" },
    { key: "floor", label: "Etage" },
    { key: "bed_configuration", label: "Bett-/Zimmerkonfiguration" },
    { key: "guest_names", label: "Haupt- und Mitreisende" },
    { key: "meal_plan", label: "Verpflegung oder gebuchte Leistungen", multiline: true },
    { key: "check_in_method", label: "Check-in-Verfahren" },
    { key: "access_instructions", label: "Zugangshinweise", multiline: true },
    { key: "access_code", label: "Schlüssel- oder Zugangscode" },
    { key: "reception_contact", label: "Rezeptionskontakt" },
    { key: "host_contact", label: "Gastgeberkontakt" },
    { key: "emergency_contact", label: "Notfallkontakt" },
    { key: "special_requests", label: "Besondere Wünsche und Hinweise", multiline: true },
    { key: "deposit", label: "Kaution" },
    { key: "tourist_tax", label: "Tourismusabgabe" },
    { key: "payment_plan", label: "Zahlungsplan" },
    { key: "booking_conditions", label: "Buchungsbedingungen", multiline: true },
    { key: "cancellation_conditions", label: "Stornierungsbedingungen", multiline: true }
  ],
  flight: [
    { key: "marketing_carrier", label: "Marketing-Fluggesellschaft" },
    { key: "operating_carrier", label: "Ausführende Fluggesellschaft" },
    { key: "flight_number", label: "Flugnummer" },
    { key: "booking_code", label: "Buchungscode / PNR" },
    { key: "ticket_number", label: "Ticketnummer" },
    { key: "flight_status", label: "Flugstatus" },
    { key: "passenger_names", label: "Passagiernamen" },
    { key: "seat", label: "Sitzplatz" },
    { key: "cabin_class", label: "Kabinenklasse" },
    { key: "booking_class", label: "Buchungsklasse" },
    { key: "fare_class", label: "Tarifklasse" },
    { key: "checked_baggage", label: "Freigepäck" },
    { key: "hand_baggage", label: "Handgepäck" },
    { key: "booked_services", label: "Gebuchte Leistungen", multiline: true },
    { key: "check_in_window", label: "Check-in-Zeitraum" },
    { key: "check_in_link", label: "Check-in-Link" },
    { key: "ticket_conditions", label: "Ticketbedingungen", multiline: true },
    { key: "fare_conditions", label: "Tarifbedingungen", multiline: true },
    { key: "rebooking_conditions", label: "Umbuchungsbedingungen", multiline: true },
    { key: "cancellation_conditions", label: "Stornierungsbedingungen", multiline: true }
  ],
  rail: [
    { key: "operator", label: "Anbieter oder Betreiber" },
    { key: "train_type", label: "Zugart" },
    { key: "train_number", label: "Zugnummer" },
    { key: "line_name", label: "Linienbezeichnung" },
    { key: "traveler_names", label: "Reisendennamen" },
    { key: "coach", label: "Wagen" },
    { key: "seat", label: "Sitzplatz" },
    { key: "class", label: "Klasse" },
    { key: "reservation_status", label: "Reservierungsstatus" },
    { key: "ticket_numbers", label: "Ticket-, Auftrags- und Reservierungsnummern" },
    { key: "ticket_type", label: "Ticketart" },
    { key: "validity_period", label: "Gültigkeitszeitraum" },
    { key: "train_binding", label: "Zugbindung" },
    { key: "fare", label: "Tarif" },
    { key: "discount", label: "BahnCard oder Ermäßigung" },
    { key: "ticket_conditions", label: "Ticketbedingungen", multiline: true },
    { key: "rebooking_conditions", label: "Umbuchungsbedingungen", multiline: true },
    { key: "cancellation_conditions", label: "Stornierungsbedingungen", multiline: true }
  ],
  bus: [
    { key: "operator", label: "Anbieter oder Betreiber" },
    { key: "route_number", label: "Linien-, Fahrt- oder Busnummer" },
    { key: "traveler_names", label: "Reisendennamen" },
    { key: "seat", label: "Sitzplatz" },
    { key: "comfort_class", label: "Komfort- oder Buchungsklasse" },
    { key: "reservation_status", label: "Reservierungsstatus" },
    { key: "ticket_numbers", label: "Ticket-, Buchungs- und Reservierungsnummern" },
    { key: "ticket_type", label: "Ticketart" },
    { key: "validity_period", label: "Gültigkeitszeitraum" },
    { key: "baggage_rules", label: "Gepäckbestimmungen", multiline: true },
    { key: "booked_services", label: "Gebuchte Zusatzleistungen", multiline: true },
    { key: "ticket_conditions", label: "Ticketbedingungen", multiline: true },
    { key: "rebooking_conditions", label: "Umbuchungsbedingungen", multiline: true },
    { key: "cancellation_conditions", label: "Stornierungsbedingungen", multiline: true }
  ],
  activity: [
    { key: "category", label: "Art oder Kategorie" },
    { key: "provider", label: "Anbieter, Veranstalter oder Guide" },
    { key: "venue_name", label: "Veranstaltungsort" },
    { key: "meeting_point", label: "Treffpunkt" },
    { key: "end_point", label: "Abweichender Endpunkt" },
    { key: "admission_time", label: "Einlass" },
    { key: "meeting_time", label: "Treffzeit" },
    { key: "duration", label: "Dauer" },
    { key: "participant_names", label: "Teilnehmernamen" },
    { key: "participant_count", label: "Teilnehmerzahl" },
    { key: "ticket_number", label: "Buchungs-, Ticket-, Gutschein- oder Voucher-Nummer" },
    { key: "ticket_type", label: "Ticketart" },
    { key: "ticket_count", label: "Anzahl Tickets" },
    { key: "seat_or_area", label: "Platz, Bereich oder Sitz" },
    { key: "language", label: "Sprache der Durchführung" },
    { key: "included_services", label: "Enthaltene Leistungen", multiline: true },
    { key: "excluded_services", label: "Nicht enthaltene Leistungen", multiline: true },
    { key: "requirements", label: "Alters-, Gesundheits-, Zugangs- oder Teilnahmevoraussetzungen", multiline: true },
    { key: "practical_notes", label: "Kleidung, Ausrüstung, Anreise und Hinweise", multiline: true },
    { key: "accessibility", label: "Barrierefreiheit" },
    { key: "contact", label: "Kontakt- und Notfallangaben" },
    { key: "rebooking_conditions", label: "Umbuchungsbedingungen", multiline: true },
    { key: "cancellation_conditions", label: "Stornierungs- und No-Show-Bedingungen", multiline: true }
  ]
};

export const transportFieldDefinitions: FieldDefinition[] = [
  { key: "operator", label: "Anbieter oder Betreiber" },
  { key: "number", label: "Fahrt-/Linien-/Zugnummer" },
  { key: "departure_facility_code", label: "Startcode (IATA, Bahnhof, Haltestelle)" },
  { key: "arrival_facility_code", label: "Zielcode (IATA, Bahnhof, Haltestelle)" },
  { key: "departure_terminal_or_platform", label: "Terminal, Gleis oder Steig" },
  { key: "arrival_terminal_or_platform", label: "Ankunftsterminal, Gleis oder Steig" },
  { key: "passenger_names", label: "Reisendennamen" },
  { key: "seat", label: "Sitzplatz" },
  { key: "cabin_or_booking_class", label: "Kabinen-, Komfort- oder Buchungsklasse" },
  { key: "reservation_status", label: "Reservierungsstatus" },
  { key: "ticket_or_booking_numbers", label: "Ticket-, Buchungs- oder Reservierungsnummern" },
  { key: "baggage_and_services", label: "Gepäck und gebuchte Leistungen", multiline: true },
  { key: "duration", label: "Dauer" },
  { key: "transfer_duration", label: "Umstiegsdauer zur nächsten Strecke" },
  { key: "conditions", label: "Ticket-, Tarif-, Umbuchungs- und Stornierungsbedingungen", multiline: true }
];

export function blankLocation(): LocationDraft {
  return {
    name: "",
    fullAddress: null,
    street: null,
    houseNumber: null,
    postalCode: null,
    city: null,
    region: null,
    countryCode: null,
    locationCodeType: null,
    locationCode: null,
    latitude: null,
    longitude: null,
    ianaTimeZone: null
  };
}

export function blankTime(date: string, precision: LocalTimeValue["precision"] = "date_only"): TimeDraft {
  return { date, precision, time: "", timeZone: "", offset: null };
}

export function blankDraft(startDate: string): FormDraft {
  return {
    eventTypeCode: "accommodation",
    title: "",
    bookingStatus: "confirmed",
    start: blankTime(startDate),
    end: blankTime(""),
    mainLocation: blankLocation(),
    startLocation: blankLocation(),
    endLocation: blankLocation(),
    providerName: "",
    bookingPlatformName: "",
    managementUrl: "",
    bookingDate: "",
    notes: "",
    references: "",
    travelers: "",
    providerContacts: "",
    totalPrice: "",
    currency: "",
    paid: "",
    outstanding: "",
    taxesAndFees: "",
    paymentStatus: "",
    paymentMethodMasked: "",
    cancellationDeadline: blankTime(""),
    cancellationConditions: "",
    additionalAttributes: "",
    typeFields: {},
    segments: []
  };
}

function stringValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(stringValue).join("\n");
  return "";
}

function timeToDraft(value: LocalTimeValue | null): TimeDraft {
  return value
    ? {
        date: value.localDate,
        precision: value.precision,
        time: value.localTime?.slice(0, 5) ?? "",
        timeZone: value.ianaTimeZone ?? "",
        offset: value.utcOffsetMinutes
      }
    : blankTime("");
}

function locationToDraft(value: LocationInput | null): LocationDraft {
  return value ? { ...value } : blankLocation();
}

export function payloadToDraft(payload: TravelItemPayload): FormDraft {
  const common = payload.commonDetails;
  return {
    eventTypeCode: payload.eventTypeCode,
    title: payload.title,
    bookingStatus: payload.bookingStatus,
    start: timeToDraft(payload.startTime),
    end: timeToDraft(payload.endTime),
    mainLocation: locationToDraft(payload.locations.main),
    startLocation: locationToDraft(payload.locations.start),
    endLocation: locationToDraft(payload.locations.end),
    providerName: common.providerName,
    bookingPlatformName: common.bookingPlatformName,
    managementUrl: common.managementUrl,
    bookingDate: common.bookingDate,
    notes: common.notes,
    references: common.references.map((reference) => `${reference.kind}:${reference.value}`).join("\n"),
    travelers: common.travelers.join("\n"),
    providerContacts: common.providerContacts
      .map((contact) => [contact.role, contact.phone, contact.email, contact.website].join(" | "))
      .join("\n"),
    totalPrice: common.price.total,
    currency: common.price.currency,
    paid: common.price.paid,
    outstanding: common.price.outstanding,
    taxesAndFees: common.price.taxesAndFees,
    paymentStatus: common.price.paymentStatus,
    paymentMethodMasked: common.price.paymentMethodMasked,
    cancellationDeadline: timeToDraft(common.cancellationDeadline),
    cancellationConditions: common.cancellationConditions,
    additionalAttributes: common.additionalAttributes.map((attribute) => `${attribute.label}=${attribute.value}|${attribute.unit}`).join("\n"),
    typeFields: Object.fromEntries(Object.entries(payload.typeDetails).map(([key, value]) => [key, stringValue(value)])),
    segments: payload.segments.map((segment) => ({
      id: segment.id,
      startLocation: { ...segment.startLocation },
      endLocation: { ...segment.endLocation },
      departure: timeToDraft(segment.departureTime),
      arrival: timeToDraft(segment.arrivalTime),
      details: Object.fromEntries(Object.entries(segment.details).map(([key, value]) => [key, stringValue(value)]))
    }))
  };
}

function itemToDraft(item: TravelItem): FormDraft {
  const common = item.commonDetails;
  const typeFields = Object.fromEntries(Object.entries(item.typeDetails).map(([key, value]) => [key, stringValue(value)]));
  const segmentDrafts = item.segments.map((segment) => ({
    id: segment.id,
    startLocation: { ...segment.startLocation },
    endLocation: { ...segment.endLocation },
    departure: timeToDraft(segment.departureTime),
    arrival: timeToDraft(segment.arrivalTime),
    details: Object.fromEntries(Object.entries(segment.details).map(([key, value]) => [key, stringValue(value)]))
  }));
  return {
    eventTypeCode: item.eventTypeCode,
    title: item.title,
    bookingStatus: item.bookingStatus,
    start: timeToDraft(item.startTime),
    end: timeToDraft(item.endTime),
    mainLocation: locationToDraft(item.locations.main),
    startLocation: locationToDraft(item.locations.start),
    endLocation: locationToDraft(item.locations.end),
    providerName: common.providerName,
    bookingPlatformName: common.bookingPlatformName,
    managementUrl: common.managementUrl,
    bookingDate: common.bookingDate,
    notes: common.notes,
    references: common.references.map((reference) => `${reference.kind}:${reference.value}`).join("\n"),
    travelers: common.travelers.join("\n"),
    providerContacts: common.providerContacts
      .map((contact) => [contact.role, contact.phone, contact.email, contact.website].join(" | "))
      .join("\n"),
    totalPrice: common.price.total,
    currency: common.price.currency,
    paid: common.price.paid,
    outstanding: common.price.outstanding,
    taxesAndFees: common.price.taxesAndFees,
    paymentStatus: common.price.paymentStatus,
    paymentMethodMasked: common.price.paymentMethodMasked,
    cancellationDeadline: timeToDraft(common.cancellationDeadline),
    cancellationConditions: common.cancellationConditions,
    additionalAttributes: common.additionalAttributes.map((attribute) => `${attribute.label}=${attribute.value}|${attribute.unit}`).join("\n"),
    typeFields,
    segments: segmentDrafts
  };
}

function locationFromDraft(value: LocationDraft, allowEmpty = false): LocationInput | null {
  if (!allowEmpty && !value.name.trim()) return null;
  return {
    ...value,
    id: value.id,
    name: value.name.trim(),
    fullAddress: value.fullAddress?.trim() || null,
    street: value.street?.trim() || null,
    houseNumber: value.houseNumber?.trim() || null,
    postalCode: value.postalCode?.trim() || null,
    city: value.city?.trim() || null,
    region: value.region?.trim() || null,
    countryCode: value.countryCode?.trim().toUpperCase() || null,
    locationCodeType: value.locationCodeType?.trim() || null,
    locationCode: value.locationCode?.trim() || null,
    ianaTimeZone: value.ianaTimeZone?.trim() || null
  };
}

function timeFromDraft(value: TimeDraft): LocalTimeValue {
  if (value.precision !== "exact_time") return makeDateOnlyTime(value.date, value.precision);
  const resolution = resolveExactLocalTime(value.date, value.time, value.timeZone, value.offset);
  return resolution.value;
}

function parseReferences(value: string): Reference[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [kind, ...rest] = line.split(":");
      const allowed = ["booking", "reservation", "order", "ticket", "voucher", "other"];
      return {
        kind: allowed.includes(kind) ? (kind as Reference["kind"]) : "other",
        value: (allowed.includes(kind) ? rest.join(":") : line).trim()
      };
    })
    .filter((reference) => reference.value);
}

function parseContacts(value: string): ProviderContact[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [role = "", phone = "", email = "", website = ""] = line.split("|").map((part) => part.trim());
      return { role, phone, email, website };
    });
}

function parseAttributes(value: string): Array<{ label: string; value: string; unit: string }> {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [labelAndValue, unit = ""] = line.split("|");
      const [label, ...rest] = labelAndValue.split("=");
      return { label: label.trim(), value: rest.join("=").trim(), unit: unit.trim() };
    })
    .filter((attribute) => attribute.label && attribute.value);
}

function segmentToPayload(segment: SegmentDraft, index: number): TravelItemSegmentInput {
  return {
    id: segment.id,
    sequenceNumber: index + 1,
    startLocation: locationFromDraft(segment.startLocation, true)!,
    endLocation: locationFromDraft(segment.endLocation, true)!,
    departureTime: timeFromDraft(segment.departure),
    arrivalTime: timeFromDraft(segment.arrival),
    details: Object.fromEntries(Object.entries(segment.details).filter(([, value]) => value.trim()))
  };
}

export function draftToPayload(draft: FormDraft): TravelItemPayload {
  return {
    eventTypeCode: draft.eventTypeCode,
    title: draft.title,
    bookingStatus: draft.bookingStatus,
    startTime: timeFromDraft(draft.start),
    endTime: draft.end.date ? timeFromDraft(draft.end) : null,
    locations: {
      main: locationFromDraft(draft.mainLocation),
      start: locationFromDraft(draft.startLocation),
      end: locationFromDraft(draft.endLocation)
    },
    commonDetails: {
      providerName: draft.providerName.trim(),
      bookingPlatformName: draft.bookingPlatformName.trim(),
      managementUrl: draft.managementUrl.trim(),
      bookingDate: draft.bookingDate,
      notes: draft.notes,
      references: parseReferences(draft.references),
      travelers: draft.travelers.split("\n").map((value) => value.trim()).filter(Boolean),
      providerContacts: parseContacts(draft.providerContacts),
      price: {
        total: draft.totalPrice.trim(),
        currency: draft.currency.trim().toUpperCase(),
        paid: draft.paid.trim(),
        outstanding: draft.outstanding.trim(),
        taxesAndFees: draft.taxesAndFees.trim(),
        paymentStatus: draft.paymentStatus.trim(),
        paymentMethodMasked: draft.paymentMethodMasked.trim()
      },
      cancellationDeadline: draft.cancellationDeadline.date ? timeFromDraft(draft.cancellationDeadline) : null,
      cancellationConditions: draft.cancellationConditions,
      additionalAttributes: parseAttributes(draft.additionalAttributes)
    },
    typeDetails: Object.fromEntries(Object.entries(draft.typeFields).filter(([, value]) => value.trim())),
    segments: draft.segments.map(segmentToPayload)
  };
}

export function updateLocationField(
  draft: FormDraft,
  key: "mainLocation" | "startLocation" | "endLocation",
  field: keyof LocationInput,
  value: string
): FormDraft {
  const numericField = field === "latitude" || field === "longitude";
  return {
    ...draft,
    [key]: {
      ...draft[key],
      [field]: numericField ? (value ? Number(value) : null) : value
    }
  };
}

export function updateTimeField(draft: FormDraft, key: "start" | "end" | "cancellationDeadline", field: keyof TimeDraft, value: string): FormDraft {
  return { ...draft, [key]: { ...draft[key], [field]: value, ...(field === "time" || field === "timeZone" ? { offset: null } : {}) } };
}

export function InputField({
  id,
  label,
  value,
  onChange,
  multiline = false,
  type = "text",
  required = false
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  type?: string;
  required?: boolean;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}{required ? " *" : ""}</label>
      {multiline ? (
        <textarea id={id} value={value} onChange={(event) => onChange(event.target.value)} rows={3} />
      ) : (
        <input id={id} type={type} value={value} required={required} onChange={(event) => onChange(event.target.value)} />
      )}
    </div>
  );
}

export function LocationFields({
  idPrefix,
  label,
  value,
  onChange
}: {
  idPrefix: string;
  label: string;
  value: LocationDraft;
  onChange: (field: keyof LocationInput, value: string) => void;
}) {
  return (
    <fieldset className="nested-fieldset">
      <legend>{label}</legend>
      <InputField id={`${idPrefix}-name`} label="Name" value={value.name} required onChange={(next) => onChange("name", next)} />
      <div className="field-grid">
        <InputField id={`${idPrefix}-city`} label="Ort" value={value.city ?? ""} onChange={(next) => onChange("city", next)} />
        <InputField id={`${idPrefix}-region`} label="Region" value={value.region ?? ""} onChange={(next) => onChange("region", next)} />
        <InputField id={`${idPrefix}-country`} label="Land (ISO-Code)" value={value.countryCode ?? ""} onChange={(next) => onChange("countryCode", next)} />
        <InputField id={`${idPrefix}-street`} label="Straße" value={value.street ?? ""} onChange={(next) => onChange("street", next)} />
        <InputField id={`${idPrefix}-house-number`} label="Hausnummer" value={value.houseNumber ?? ""} onChange={(next) => onChange("houseNumber", next)} />
        <InputField id={`${idPrefix}-postal-code`} label="Postleitzahl" value={value.postalCode ?? ""} onChange={(next) => onChange("postalCode", next)} />
        <InputField id={`${idPrefix}-code-type`} label="Codeart" value={value.locationCodeType ?? ""} onChange={(next) => onChange("locationCodeType", next)} />
        <InputField id={`${idPrefix}-code`} label="Orts-/Anbietercode" value={value.locationCode ?? ""} onChange={(next) => onChange("locationCode", next)} />
        <InputField id={`${idPrefix}-latitude`} label="Breitengrad (optional)" type="number" value={value.latitude === null ? "" : String(value.latitude)} onChange={(next) => onChange("latitude", next)} />
        <InputField id={`${idPrefix}-longitude`} label="Längengrad (optional)" type="number" value={value.longitude === null ? "" : String(value.longitude)} onChange={(next) => onChange("longitude", next)} />
      </div>
      <InputField id={`${idPrefix}-address`} label="Vollständige Adresse" value={value.fullAddress ?? ""} onChange={(next) => onChange("fullAddress", next)} />
      <InputField id={`${idPrefix}-zone`} label="Typische IANA-Zeitzone (optional)" value={value.ianaTimeZone ?? ""} onChange={(next) => onChange("ianaTimeZone", next)} />
    </fieldset>
  );
}

export function TimeFields({
  idPrefix,
  label,
  value,
  onChange,
  required = true
}: {
  idPrefix: string;
  label: string;
  value: TimeDraft;
  onChange: (field: keyof TimeDraft, value: string) => void;
  required?: boolean;
}) {
  return (
    <fieldset className="nested-fieldset">
      <legend>{label}</legend>
      <div className="field-grid">
        <InputField id={`${idPrefix}-date`} label="Lokales Datum" value={value.date} type="date" required={required} onChange={(next) => onChange("date", next)} />
        <div className="field">
          <label htmlFor={`${idPrefix}-precision`}>Zeitgenauigkeit</label>
          <select id={`${idPrefix}-precision`} value={value.precision} onChange={(event) => onChange("precision", event.target.value)}>
            <option value="date_only">Nur Datum</option>
            <option value="unknown_time">Uhrzeit unbekannt</option>
            <option value="exact_time">Exakte Uhrzeit</option>
          </select>
        </div>
      </div>
      {value.precision === "exact_time" ? (
        <div className="field-grid">
          <InputField id={`${idPrefix}-time`} label="Lokale Uhrzeit" value={value.time} type="time" required={required} onChange={(next) => onChange("time", next)} />
          <InputField id={`${idPrefix}-iana-zone`} label="IANA-Zeitzone" value={value.timeZone} required={required} onChange={(next) => onChange("timeZone", next)} />
        </div>
      ) : (
        <p className="field-hint">Es wird keine Uhrzeit erfunden. Die fachliche Ortszeit bleibt als Datum erhalten.</p>
      )}
    </fieldset>
  );
}

export function SegmentFields({
  segment,
  index,
  onChange,
  onMove,
  onRemove,
  canMoveUp,
  canMoveDown
}: {
  segment: SegmentDraft;
  index: number;
  onChange: (next: SegmentDraft) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}) {
  const updateLocation = (key: "startLocation" | "endLocation") => (field: keyof LocationInput, value: string) => {
    onChange({ ...segment, [key]: { ...segment[key], [field]: value } });
  };
  const updateTime = (key: "departure" | "arrival") => (field: keyof TimeDraft, value: string) => {
    onChange({ ...segment, [key]: { ...segment[key], [field]: value, ...(field === "time" || field === "timeZone" ? { offset: null } : {}) } });
  };
  const updateDetail = (key: string, value: string) => onChange({ ...segment, details: { ...segment.details, [key]: value } });
  return (
    <fieldset className="segment-card">
      <legend>Teilstrecke {index + 1}</legend>
      <div className="segment-actions">
        <button type="button" className="link-button" onClick={() => onMove(-1)} disabled={!canMoveUp}>Nach oben</button>
        <button type="button" className="link-button" onClick={() => onMove(1)} disabled={!canMoveDown}>Nach unten</button>
        <button type="button" className="link-button destructive-link" onClick={onRemove}>Teilstrecke entfernen</button>
      </div>
      <LocationFields idPrefix={`segment-${index}-start`} label="Abfahrts-/Startort" value={segment.startLocation} onChange={updateLocation("startLocation")} />
      <LocationFields idPrefix={`segment-${index}-end`} label="Ankunfts-/Zielort" value={segment.endLocation} onChange={updateLocation("endLocation")} />
      <TimeFields idPrefix={`segment-${index}-departure`} label="Abfahrt" value={segment.departure} onChange={updateTime("departure")} />
      <TimeFields idPrefix={`segment-${index}-arrival`} label="Ankunft" value={segment.arrival} onChange={updateTime("arrival")} />
      <div className="field-grid">
        {transportFieldDefinitions.map((field) => (
          <InputField
            key={field.key}
            id={`segment-${index}-${field.key}`}
            label={field.label}
            value={segment.details[field.key] ?? ""}
            multiline={field.multiline}
            onChange={(next) => updateDetail(field.key, next)}
          />
        ))}
      </div>
    </fieldset>
  );
}

export function TravelItemFormPage() {
  const { route, navigate } = useRouter();
  const { state: tripState } = useTrip();
  const { state: itemState, isSaving, create, update, getItem } = useTravelItems();
  const itemRoute = travelItemRouteFromPath(route.path);
  const editItem = itemRoute?.kind === "edit" ? getItem(itemRoute.itemId) : null;
  const isEdit = itemRoute?.kind === "edit";
  const startDate = tripState.status === "ready" ? tripState.trip.startDate : "";
  const [draft, setDraft] = useState<FormDraft>(() => editItem ? itemToDraft(editItem) : blankDraft(startDate));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const firstErrorRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (editItem) setDraft(itemToDraft(editItem));
  }, [editItem]);

  useEffect(() => {
    if (!isEdit && startDate && !draft.start.date) {
      setDraft((current) => ({ ...current, start: { ...current.start, date: startDate }, end: { ...current.end, date: startDate } }));
    }
  }, [draft.start.date, isEdit, startDate]);

  const fieldDefinitions = useMemo(() => typeFieldDefinitions[draft.eventTypeCode], [draft.eventTypeCode]);
  const updateDraftField = (key: keyof FormDraft, value: string) => {
    setDraft((current) => ({ ...current, [key]: value } as FormDraft));
    setSubmitError(null);
  };
  const updateLocation = (key: "mainLocation" | "startLocation" | "endLocation") => (field: keyof LocationInput, value: string) => {
    setDraft((current) => updateLocationField(current, key, field, value));
    setSubmitError(null);
  };
  const updateTime = (key: "start" | "end") => (field: keyof TimeDraft, value: string) => {
    setDraft((current) => updateTimeField(current, key, field, value));
    setSubmitError(null);
  };

  function addSegments() {
    setDraft((current) => ({
      ...current,
      segments: current.segments.length >= 2
        ? [...current.segments, newSegment(current.start.date)]
        : [newSegment(current.start.date), newSegment(current.start.date)]
    }));
  }

  function newSegment(date: string): SegmentDraft {
    return {
      startLocation: blankLocation(),
      endLocation: blankLocation(),
      departure: blankTime(date),
      arrival: blankTime(date),
      details: {}
    };
  }

  function moveSegment(index: number, direction: -1 | 1) {
    setDraft((current) => {
      const next = [...current.segments];
      const target = index + direction;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return { ...current, segments: next };
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload = draftToPayload(draft);
    const nextErrors = validateTravelItemPayload(payload);
    setErrors(nextErrors);
    setSubmitError(null);
    const firstError = Object.values(nextErrors)[0];
    if (firstError) {
      firstErrorRef.current?.focus();
      return;
    }
    const result = isEdit && editItem
      ? await update(editItem.id, editItem.version, payload, createIdempotencyKey())
      : await create(payload, createIdempotencyKey());
    if (result.kind === "created" || result.kind === "updated") {
      navigate(`/events/${result.item.id}`, { replace: true });
      return;
    }
    if (result.kind === "conflict") {
      if (result.item) setDraft(itemToDraft(result.item));
      setSubmitError("Das Ereignis wurde zwischenzeitlich geändert. Der neue Stand wurde geladen.");
      return;
    }
    setSubmitError(result.kind === "validation" || result.kind === "limit" || result.kind === "forbidden" ? result.message : "Das Ereignis konnte nicht gespeichert werden. Ihre Eingaben bleiben erhalten.");
  }

  if (itemState.status === "loading" && isEdit) return <section className="state-card"><p>Ereignis wird geladen …</p></section>;
  if (isEdit && !editItem) {
    return (
      <section className="state-card" role="alert">
        <h1>Ereignis nicht gefunden</h1>
        <p>Das Ereignis ist nicht vorhanden oder nicht mehr zugänglich.</p>
        <button className="primary-button state-action" type="button" onClick={() => navigate("/app")}>Zur Timeline</button>
      </section>
    );
  }
  if (itemRoute?.kind !== "create" && !isEdit) return null;

  const summaryMessage = submitError ?? (itemState.status === "error" ? itemState.message : null);
  const isTransport = ["flight", "rail", "bus"].includes(draft.eventTypeCode);
  return (
    <section className="form-card travel-item-form" aria-labelledby="travel-item-form-title">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Manuelles Reiseereignis</p>
          <h1 id="travel-item-form-title">{isEdit ? "Ereignis bearbeiten" : "Ereignis anlegen"}</h1>
        </div>
        <button className="link-button" type="button" onClick={() => navigate(isEdit && editItem ? `/events/${editItem.id}` : "/app")}>Abbrechen</button>
      </div>
      {summaryMessage ? <div className="error-summary" role="alert"><p>{summaryMessage}</p></div> : null}
      {Object.keys(errors).length > 0 ? (
        <div className="error-summary" role="alert" aria-labelledby="travel-item-validation-title">
          <p id="travel-item-validation-title">Bitte prüfen Sie folgende Angaben:</p>
          <ul>{Object.values(errors).map((message, index) => <li key={`${message}-${index}`}>{message}</li>)}</ul>
        </div>
      ) : null}
      <form onSubmit={handleSubmit} noValidate>
        <div className="field-grid">
          <div className="field">
            <label htmlFor="travel-item-type">Ereignisart</label>
            <select id="travel-item-type" value={draft.eventTypeCode} onChange={(event) => updateDraftField("eventTypeCode", event.target.value)}>
              {(Object.keys(eventTypeLabels) as EventTypeCode[]).map((code) => <option key={code} value={code}>{eventTypeLabels[code]}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="travel-item-status">Buchungsstatus</label>
            <select id="travel-item-status" value={draft.bookingStatus} onChange={(event) => updateDraftField("bookingStatus", event.target.value)}>
              <option value="confirmed">Bestätigt</option>
              <option value="cancelled">Storniert</option>
              <option value="unknown">Unbekannt</option>
            </select>
          </div>
        </div>
        <InputField id="travel-item-title" label="Titel" value={draft.title} required onChange={(next) => updateDraftField("title", next)} />
        <TimeFields idPrefix="travel-item-start" label="Beginn *" value={draft.start} onChange={updateTime("start")} />
        <details open>
          <summary>Optionales Ende</summary>
          <TimeFields idPrefix="travel-item-end" label="Ende" value={draft.end} required={false} onChange={updateTime("end")} />
        </details>
        <details open>
          <summary>Zentrale Orte und Verbindungen</summary>
          <LocationFields idPrefix="travel-item-main-location" label="Hauptort" value={draft.mainLocation} onChange={updateLocation("mainLocation")} />
          <LocationFields idPrefix="travel-item-start-location" label="Startort" value={draft.startLocation} onChange={updateLocation("startLocation")} />
          <LocationFields idPrefix="travel-item-end-location" label="Zielort" value={draft.endLocation} onChange={updateLocation("endLocation")} />
        </details>
        <details>
          <summary>Buchungs- und Anbieterdaten</summary>
          <div className="field-grid">
            <InputField id="travel-item-provider" label="Anbieter / Betreiber / Veranstalter" value={draft.providerName} onChange={(next) => updateDraftField("providerName", next)} />
            <InputField id="travel-item-platform" label="Vermittler / Buchungsplattform" value={draft.bookingPlatformName} onChange={(next) => updateDraftField("bookingPlatformName", next)} />
            <InputField id="travel-item-booking-date" label="Buchungsdatum" type="date" value={draft.bookingDate} onChange={(next) => updateDraftField("bookingDate", next)} />
            <InputField id="travel-item-management-url" label="Buchungs-, Check-in- oder Verwaltungslink" type="url" value={draft.managementUrl} onChange={(next) => updateDraftField("managementUrl", next)} />
          </div>
          <InputField id="travel-item-references" label="Buchungs-/Reservierungs-/Ticketnummern (eine pro Zeile, optional mit art:value)" multiline value={draft.references} onChange={(next) => updateDraftField("references", next)} />
          <InputField id="travel-item-travelers" label="Reisende oder Gäste (eine Person pro Zeile)" multiline value={draft.travelers} onChange={(next) => updateDraftField("travelers", next)} />
          <InputField id="travel-item-contacts" label="Anbieterkontakte (Rolle | Telefon | E-Mail | Website)" multiline value={draft.providerContacts} onChange={(next) => updateDraftField("providerContacts", next)} />
        </details>
        <details>
          <summary>Preise und Bedingungen</summary>
          <div className="field-grid">
            <InputField id="travel-item-total-price" label="Gesamtpreis" value={draft.totalPrice} onChange={(next) => updateDraftField("totalPrice", next)} />
            <InputField id="travel-item-currency" label="Währung (ISO 4217)" value={draft.currency} onChange={(next) => updateDraftField("currency", next)} />
            <InputField id="travel-item-paid" label="Bereits bezahlt" value={draft.paid} onChange={(next) => updateDraftField("paid", next)} />
            <InputField id="travel-item-outstanding" label="Noch offen" value={draft.outstanding} onChange={(next) => updateDraftField("outstanding", next)} />
            <InputField id="travel-item-taxes" label="Steuern und Gebühren" value={draft.taxesAndFees} onChange={(next) => updateDraftField("taxesAndFees", next)} />
            <InputField id="travel-item-payment-status" label="Zahlungsstatus" value={draft.paymentStatus} onChange={(next) => updateDraftField("paymentStatus", next)} />
            <InputField id="travel-item-payment-method" label="Zahlungsart (höchstens maskiert)" value={draft.paymentMethodMasked} onChange={(next) => updateDraftField("paymentMethodMasked", next)} />
          </div>
          <TimeFields idPrefix="travel-item-cancellation-deadline" label="Stornierungsfrist (optional)" value={draft.cancellationDeadline} required={false} onChange={(field, value) => setDraft((current) => updateTimeField(current, "cancellationDeadline", field, value))} />
          <InputField id="travel-item-cancellation" label="Stornierungsfrist und Bedingungen" multiline value={draft.cancellationConditions} onChange={(next) => updateDraftField("cancellationConditions", next)} />
        </details>
        {isTransport ? (
          <details open>
            <summary>Teilstrecken</summary>
            <p className="field-hint">Für Flug, Bahn und Bus können mindestens zwei geordnete Teilstrecken erfasst werden. Keine breite Tabelle ist erforderlich.</p>
            <button type="button" className="secondary-button" onClick={addSegments}>Teilstrecken hinzufügen</button>
            {draft.segments.map((segment, index) => (
              <SegmentFields
                key={segment.id ?? `new-${index}`}
                segment={segment}
                index={index}
                onChange={(next) => setDraft((current) => ({ ...current, segments: current.segments.map((item, itemIndex) => itemIndex === index ? next : item) }))}
                onMove={(direction) => moveSegment(index, direction)}
                onRemove={() => setDraft((current) => ({ ...current, segments: current.segments.filter((_, itemIndex) => itemIndex !== index) }))}
                canMoveUp={index > 0}
                canMoveDown={index < draft.segments.length - 1}
              />
            ))}
          </details>
        ) : null}
        <details open>
          <summary>{eventTypeLabels[draft.eventTypeCode]} – weitere Angaben</summary>
          <div className="field-grid">
            {fieldDefinitions.map((field) => (
              <InputField
                key={field.key}
                id={`travel-item-type-${field.key}`}
                label={field.label}
                multiline={field.multiline}
                value={draft.typeFields[field.key] ?? ""}
                onChange={(next) => setDraft((current) => ({ ...current, typeFields: { ...current.typeFields, [field.key]: next } }))}
              />
            ))}
          </div>
        </details>
        <details>
          <summary>Notizen und zusätzliche Angaben</summary>
          <InputField id="travel-item-notes" label="Freie Notizen" multiline value={draft.notes} onChange={(next) => updateDraftField("notes", next)} />
          <InputField id="travel-item-attributes" label="Zusätzliche Anbieterangaben (label=value|Einheit, eine pro Zeile)" multiline value={draft.additionalAttributes} onChange={(next) => updateDraftField("additionalAttributes", next)} />
        </details>
        <div className="form-actions">
          <button ref={firstErrorRef} className="primary-button" type="submit" disabled={isSaving} aria-busy={isSaving}>
            {isSaving ? "Ereignis wird gespeichert …" : isEdit ? "Änderungen speichern" : "Ereignis speichern"}
          </button>
        </div>
      </form>
    </section>
  );
}
