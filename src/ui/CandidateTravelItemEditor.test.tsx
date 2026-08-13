import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { useState } from "react";
import { blankDraft, draftToPayload, payloadToDraft, type FormDraft } from "./TravelItemFormPage";
import { CandidateTravelItemEditor } from "./CandidateTravelItemEditor";

function EditorHarness() {
  const [draft, setDraft] = useState<FormDraft>(() => ({ ...blankDraft("2026-09-01"), title: "Erkannt" }));
  return <CandidateTravelItemEditor draft={draft} onChange={setDraft} />;
}

describe("strukturierter Kandidateneditor", () => {
  it("bietet für alle fünf Ereignisarten zugängliche typspezifische Felder", async () => {
    const user = userEvent.setup();
    render(<EditorHarness />);
    const type = screen.getByLabelText("Ereignisart");
    for (const [code, field] of [
      ["accommodation", "Name der Unterkunft"],
      ["flight", "Marketing-Fluggesellschaft"],
      ["rail", "Zugart"],
      ["bus", "Linien-, Fahrt- oder Busnummer"],
      ["activity", "Art oder Kategorie"]
    ] as const) {
      await user.selectOptions(type, code);
      expect(screen.getByLabelText(field)).toBeInTheDocument();
    }
  });

  it("fügt bei einem Verkehrsereignis wiederholbare, geordnete Teilstrecken hinzu", async () => {
    const user = userEvent.setup();
    render(<EditorHarness />);
    await user.selectOptions(screen.getByLabelText("Ereignisart"), "rail");
    await user.click(screen.getByRole("button", { name: "Teilstrecken hinzufügen" }));
    expect(screen.getByText("Teilstrecke 1")).toBeInTheDocument();
    expect(screen.getByText("Teilstrecke 2")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Nach oben" })[0]).toBeDisabled();
    expect(screen.getAllByRole("button", { name: "Teilstrecke entfernen" })).toHaveLength(2);
  });

  it("entfernt beim Typwechsel unsichtbare inkompatible Felder und Teilstrecken", async () => {
    const user = userEvent.setup();
    function SwitchHarness() {
      const [draft, setDraft] = useState<FormDraft>(() => ({ ...blankDraft("2026-09-01"), eventTypeCode: "flight", typeFields: { flight_number: "XY1" }, segments: [{ startLocation: { ...blankDraft("").startLocation }, endLocation: { ...blankDraft("").endLocation }, departure: blankDraft("2026-09-01").start, arrival: blankDraft("2026-09-01").start, details: {} }, { startLocation: { ...blankDraft("").startLocation }, endLocation: { ...blankDraft("").endLocation }, departure: blankDraft("2026-09-01").start, arrival: blankDraft("2026-09-01").start, details: {} }] }));
      return <><CandidateTravelItemEditor draft={draft} onChange={setDraft} /><output data-testid="draft">{JSON.stringify(draft)}</output></>;
    }
    render(<SwitchHarness />);
    await user.selectOptions(screen.getByLabelText("Ereignisart"), "activity");
    expect(JSON.parse(screen.getByTestId("draft").textContent ?? "{}")).toMatchObject({ eventTypeCode: "activity", typeFields: {}, segments: [] });
  });

  it("bewahrt Referenzen der Art other verlustlos", () => {
    const payload = draftToPayload(payloadToDraft({
      eventTypeCode: "activity", title: "Test", bookingStatus: "unknown",
      startTime: { localDate: "2026-09-01", localTime: null, precision: "date_only", ianaTimeZone: null, utcOffsetMinutes: null, instantUtc: null, resolutionStatus: "date_only" },
      endTime: null, locations: { main: null, start: null, end: null },
      commonDetails: { providerName: "", bookingPlatformName: "", managementUrl: "", bookingDate: "", notes: "", references: [{ kind: "other", value: "X-1" }], travelers: [], providerContacts: [], price: { total: "", currency: "", paid: "", outstanding: "", taxesAndFees: "", paymentStatus: "", paymentMethodMasked: "" }, cancellationDeadline: null, cancellationConditions: "", additionalAttributes: [] },
      typeDetails: {}, segments: []
    }));
    expect(payload.commonDetails.references).toEqual([{ kind: "other", value: "X-1" }]);
  });
});
