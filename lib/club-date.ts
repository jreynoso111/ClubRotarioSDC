// Server and browser ICU data disagree on spacing in "p. m." (Node emits a
// no-break space), which breaks hydration. Only numeric parts come from Intl;
// the labels are fixed here so both renders produce identical text.
const months = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic"];
const clubParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Santo_Domingo", year: "numeric", month: "numeric", day: "numeric",
  hour: "numeric", minute: "2-digit", hourCycle: "h23",
});

export function formatClubDate(value: string | Date, withTime = true) {
  const fields = Object.fromEntries(clubParts.formatToParts(new Date(value)).map(part => [part.type, part.value]));
  const date = `${Number(fields.day)} ${months[Number(fields.month) - 1]} ${fields.year}`;
  if (!withTime) return date;
  const hour = Number(fields.hour);
  return `${date}, ${hour % 12 || 12}:${fields.minute} ${hour < 12 ? "a. m." : "p. m."}`;
}
