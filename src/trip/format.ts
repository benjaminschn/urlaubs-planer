const dateFormatter = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric"
});

export function formatTripDate(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) {
    return value;
  }
  return dateFormatter.format(new Date(year, month - 1, day));
}

export function formatTripDateRange(startDate: string, endDate: string): string {
  return `${formatTripDate(startDate)} – ${formatTripDate(endDate)}`;
}
