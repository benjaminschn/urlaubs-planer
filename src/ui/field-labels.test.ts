import { describe, expect, it } from "vitest";
import { formatFieldKey, formatFieldPath } from "./field-labels";

describe("field-labels", () => {
  it("übersetzt technische Pfade in lesbare deutsche Bezeichnungen", () => {
    expect(formatFieldPath("check_out.local_date")).toBe("Check-out · Lokales Datum");
    expect(formatFieldPath("start.local_date")).toBe("Beginn · Lokales Datum");
    expect(formatFieldPath("check_in_date")).toBe("Check-in-Datum");
    expect(formatFieldKey("local_date")).toBe("Lokales Datum");
    expect(formatFieldKey("accommodation_name")).toBe("Name der Unterkunft");
  });

  it("formatiert unbekannte Schlüssel lesbar statt raw snake_case", () => {
    expect(formatFieldKey("some_unknown_field")).toBe("Some Unknown Field");
    expect(formatFieldPath("foo.bar_baz")).toBe("Foo · Bar Baz");
  });
});
