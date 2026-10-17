"use client";

import { downloadIcs, type CalendarEvent } from "@/lib/ics";

export function AddToCalendar({ event, fileName, className }: { event: CalendarEvent; fileName: string; className?: string }) {
  return <button type="button" className={className} onClick={() => downloadIcs(event, fileName)}>Agregar a mi calendario</button>;
}
