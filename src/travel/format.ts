import type { EventTypeCode, LocalTimeValue, TravelItem } from "./types";

export const eventTypeLabels: Record<EventTypeCode, string> = {
  accommodation: "Unterkunft",
  flight: "Flug",
  rail: "Bahn",
  bus: "Bus",
  activity: "Aktivität"
};

export function formatLocalDate(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return value;
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(new Date(year, month - 1, day));
}

export function formatLocalTime(value: LocalTimeValue): string {
  const date = formatLocalDate(value.localDate);
  if (value.precision !== "exact_time" || !value.localTime) {
    return `${date} · ${value.precision === "unknown_time" ? "Uhrzeit nicht angegeben" : "ganztägig"}`;
  }
  const zone = value.ianaTimeZone ? ` (${value.ianaTimeZone})` : "";
  return `${date} · ${value.localTime.slice(0, 5)}${zone}`;
}

export function formatTimeRange(start: LocalTimeValue, end: LocalTimeValue | null): string {
  if (!end) return formatLocalTime(start);
  const startDate = formatLocalDate(start.localDate);
  const endDate = formatLocalDate(end.localDate);
  const startPart = start.precision === "exact_time" && start.localTime ? start.localTime.slice(0, 5) : "ganztägig";
  const endPart = end.precision === "exact_time" && end.localTime ? end.localTime.slice(0, 5) : "ganztägig";
  const zone = start.ianaTimeZone ? ` (${start.ianaTimeZone})` : "";
  return `${startDate} ${startPart} – ${endDate} ${endPart}${zone}`;
}

function compareItems(left: TravelItem, right: TravelItem): number {
  const leftDate = left.startTime.localDate.localeCompare(right.startTime.localDate);
  if (leftDate !== 0) return leftDate;
  if (left.startTime.precision === "exact_time" && right.startTime.precision === "exact_time") {
    const leftInstant = left.startTime.instantUtc ?? "";
    const rightInstant = right.startTime.instantUtc ?? "";
    const instantCompare = leftInstant.localeCompare(rightInstant);
    if (instantCompare !== 0) return instantCompare;
  } else if (left.startTime.precision === "exact_time" && right.startTime.precision !== "exact_time") {
    return -1;
  } else if (left.startTime.precision !== "exact_time" && right.startTime.precision === "exact_time") {
    return 1;
  }
  return left.stableSortKey.localeCompare(right.stableSortKey);
}

export function sortTravelItems(items: TravelItem[]): TravelItem[] {
  return [...items].sort(compareItems);
}

export function groupTravelItems(items: TravelItem[]): Array<{ localDate: string; items: TravelItem[] }> {
  const groups = new Map<string, TravelItem[]>();
  for (const item of sortTravelItems(items)) {
    const current = groups.get(item.startTime.localDate) ?? [];
    current.push(item);
    groups.set(item.startTime.localDate, current);
  }
  return [...groups.entries()].map(([localDate, groupedItems]) => ({ localDate, items: groupedItems }));
}

export function createIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `travel-item-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
