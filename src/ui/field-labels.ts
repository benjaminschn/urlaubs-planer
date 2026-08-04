/**
 * Human-readable German labels for snake_case keys and dotted field paths.
 * Prevents raw technical labels like "Check Out.Local Date" in the UI.
 */

const SEGMENT_TOKENS: Record<string, string> = {
  // Time / location structure
  start: "Beginn",
  end: "Ende",
  check_in: "Check-in",
  check_out: "Check-out",
  local_date: "Lokales Datum",
  local_time: "Lokale Uhrzeit",
  precision: "Zeitgenauigkeit",
  iana_time_zone: "IANA-Zeitzone",
  utc_offset_minutes: "UTC-Offset (Minuten)",
  instant_utc: "UTC-Zeitpunkt",
  resolution_status: "Auflösungsstatus",
  date_only: "Nur Datum",
  unknown_time: "Uhrzeit unbekannt",
  exact_time: "Exakte Uhrzeit",
  resolved: "Aufgelöst",
  unresolved: "Nicht aufgelöst",

  // Core event
  title: "Titel",
  event_type_code: "Ereignisart",
  booking_status: "Buchungsstatus",
  start_time: "Beginn",
  end_time: "Ende",
  locations: "Orte",
  main: "Hauptort",
  segments: "Teilstrecken",
  common_details: "Allgemeine Angaben",
  type_details: "Typspezifische Angaben",
  notes: "Notizen",

  // Location fields
  name: "Name",
  city: "Ort",
  region: "Region",
  country_code: "Land",
  street: "Straße",
  house_number: "Hausnummer",
  postal_code: "Postleitzahl",
  full_address: "Vollständige Adresse",
  location_code: "Ortscode",
  location_code_type: "Codeart",
  latitude: "Breitengrad",
  longitude: "Längengrad",

  // Common details
  provider_name: "Anbieter",
  booking_platform_name: "Buchungsplattform",
  management_url: "Verwaltungslink",
  booking_date: "Buchungsdatum",
  references: "Referenzen",
  travelers: "Reisende",
  provider_contacts: "Anbieterkontakte",
  price: "Preis",
  total: "Gesamtpreis",
  currency: "Währung",
  paid: "Bereits bezahlt",
  outstanding: "Noch offen",
  taxes_and_fees: "Steuern und Gebühren",
  payment_status: "Zahlungsstatus",
  payment_method_masked: "Zahlungsart",
  cancellation_deadline: "Stornierungsfrist",
  cancellation_conditions: "Stornierungsbedingungen",
  additional_attributes: "Zusätzliche Angaben",
  label: "Bezeichnung",
  value: "Wert",
  unit: "Einheit",
  role: "Rolle",
  phone: "Telefon",
  email: "E-Mail",
  website: "Website",
  kind: "Art",

  // Accommodation
  accommodation_name: "Name der Unterkunft",
  accommodation_type: "Art der Unterkunft",
  check_in_date: "Check-in-Datum",
  check_in_time_window: "Check-in-Uhrzeit oder Zeitfenster",
  check_out_date: "Check-out-Datum",
  check_out_time_window: "Check-out-Uhrzeit oder Zeitfenster",
  nights: "Anzahl Nächte",
  rooms: "Anzahl Zimmer",
  guests: "Anzahl Gäste",
  room_name: "Zimmerbezeichnung",
  room_number: "Zimmernummer",
  floor: "Etage",
  bed_configuration: "Bettkonfiguration",
  guest_names: "Gästenamen",
  meal_plan: "Verpflegung",
  check_in_method: "Check-in-Verfahren",
  access_instructions: "Zugangshinweise",
  access_code: "Zugangscode",
  reception_contact: "Rezeptionskontakt",
  host_contact: "Gastgeberkontakt",
  emergency_contact: "Notfallkontakt",
  special_requests: "Besondere Wünsche",
  deposit: "Kaution",
  tourist_tax: "Tourismusabgabe",
  payment_plan: "Zahlungsplan",
  booking_conditions: "Buchungsbedingungen",

  // Flight
  marketing_carrier: "Marketing-Fluggesellschaft",
  operating_carrier: "Ausführende Fluggesellschaft",
  flight_number: "Flugnummer",
  booking_code: "Buchungscode",
  ticket_number: "Ticketnummer",
  flight_status: "Flugstatus",
  passenger_names: "Passagiernamen",
  seat: "Sitzplatz",
  cabin_class: "Kabinenklasse",
  booking_class: "Buchungsklasse",
  fare_class: "Tarifklasse",
  checked_baggage: "Freigepäck",
  hand_baggage: "Handgepäck",
  booked_services: "Gebuchte Leistungen",
  check_in_window: "Check-in-Zeitraum",
  check_in_link: "Check-in-Link",
  ticket_conditions: "Ticketbedingungen",
  fare_conditions: "Tarifbedingungen",
  rebooking_conditions: "Umbuchungsbedingungen",

  // Rail / bus
  operator: "Anbieter oder Betreiber",
  train_type: "Zugart",
  train_number: "Zugnummer",
  line_name: "Linienbezeichnung",
  traveler_names: "Reisendennamen",
  coach: "Wagen",
  class: "Klasse",
  reservation_status: "Reservierungsstatus",
  ticket_numbers: "Ticketnummern",
  ticket_type: "Ticketart",
  validity_period: "Gültigkeitszeitraum",
  train_binding: "Zugbindung",
  fare: "Tarif",
  discount: "Ermäßigung",
  route_number: "Linien- oder Fahrtnummer",
  comfort_class: "Komfortklasse",
  baggage_rules: "Gepäckbestimmungen",

  // Activity
  category: "Kategorie",
  provider: "Anbieter",
  venue_name: "Veranstaltungsort",
  meeting_point: "Treffpunkt",
  end_point: "Endpunkt",
  admission_time: "Einlass",
  meeting_time: "Treffzeit",
  duration: "Dauer",
  participant_names: "Teilnehmernamen",
  participant_count: "Teilnehmerzahl",
  ticket_count: "Anzahl Tickets",
  seat_or_area: "Platz oder Bereich",
  language: "Sprache",
  included_services: "Enthaltene Leistungen",
  excluded_services: "Nicht enthaltene Leistungen",
  requirements: "Voraussetzungen",
  practical_notes: "Praktische Hinweise",
  accessibility: "Barrierefreiheit",
  contact: "Kontakt",

  // Segments / transport details
  number: "Fahrt- oder Liniennummer",
  departure_facility_code: "Startcode",
  arrival_facility_code: "Zielcode",
  departure_terminal_or_platform: "Abfahrtsterminal oder Gleis",
  arrival_terminal_or_platform: "Ankunftsterminal oder Gleis",
  cabin_or_booking_class: "Kabine oder Buchungsklasse",
  ticket_or_booking_numbers: "Ticket- oder Buchungsnummern",
  baggage_and_services: "Gepäck und Leistungen",
  departure: "Abfahrt",
  arrival: "Ankunft",
  start_location: "Startort",
  end_location: "Zielort",
  departure_time: "Abfahrtszeit",
  arrival_time: "Ankunftszeit",
  sequence_number: "Reihenfolge",
  details: "Details",

  // Status / meta
  confirmed: "Bestätigt",
  cancelled: "Storniert",
  unknown: "Unbekannt",
  accommodation: "Unterkunft",
  flight: "Flug",
  rail: "Bahn",
  bus: "Bus",
  activity: "Aktivität"
};

function titleCaseWords(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function labelSegment(segment: string): string {
  const trimmed = segment.trim();
  if (!trimmed) return "";
  if (/^\d+$/.test(trimmed)) return `Eintrag ${Number(trimmed) + 1}`;
  if (SEGMENT_TOKENS[trimmed]) return SEGMENT_TOKENS[trimmed];
  // camelCase → snake for lookup
  const asSnake = trimmed.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
  if (SEGMENT_TOKENS[asSnake]) return SEGMENT_TOKENS[asSnake];
  return titleCaseWords(asSnake.replaceAll("_", " "));
}

/** Format a single object key for display (e.g. local_date → Lokales Datum). */
export function formatFieldKey(key: string): string {
  if (!key) return "";
  if (key.includes(".")) return formatFieldPath(key);
  return labelSegment(key);
}

/** Format a dotted field path (e.g. check_out.local_date → Check-out · Lokales Datum). */
export function formatFieldPath(path: string): string {
  if (!path) return "";
  const parts = path
    .split(".")
    .map((part) => labelSegment(part))
    .filter(Boolean);
  return parts.join(" · ");
}
