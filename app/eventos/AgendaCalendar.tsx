"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import type { PublicEvent } from "@/lib/editorial";

import styles from "./events.module.css";

const CLUB_TIMEZONE = "America/Santo_Domingo";
const WEEKDAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

const toneClasses: Record<PublicEvent["tone"], string> = {
  lime: styles.calendarEventLime,
  sun: styles.calendarEventSun,
  coral: styles.calendarEventCoral,
  teal: styles.calendarEventTeal,
};

type CalendarDay = {
  date: Date;
  dateKey: string;
  day: number;
  isOutside: boolean;
};

function datePart(value: string, type: "year" | "month" | "day") {
  return new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "2-digit",
    timeZone: CLUB_TIMEZONE,
    year: "numeric",
  })
    .formatToParts(new Date(value))
    .find((part) => part.type === type)?.value;
}

function dateKey(value: string | Date) {
  const source = value instanceof Date ? value.toISOString() : value;
  const year = datePart(source, "year");
  const month = datePart(source, "month");
  const day = datePart(source, "day");
  return `${year}-${month}-${day}`;
}

function parseMonthKey(value: string) {
  const [year, month] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 1));
}

function monthKey(value: Date) {
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}`;
}

function buildCalendarDays(month: Date): CalendarDay[] {
  const year = month.getUTCFullYear();
  const monthIndex = month.getUTCMonth();
  const firstWeekday = (new Date(Date.UTC(year, monthIndex, 1)).getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const totalCells = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;

  return Array.from({ length: totalCells }, (_, index) => {
    const date = new Date(Date.UTC(year, monthIndex, 1 - firstWeekday + index));
    return {
      date,
      dateKey: `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`,
      day: date.getUTCDate(),
      isOutside: date.getUTCMonth() !== monthIndex,
    };
  });
}

function formatMonth(value: Date) {
  const label = new Intl.DateTimeFormat("es-DO", {
    month: "long",
    timeZone: "UTC",
    year: "numeric",
  }).format(value);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export default function AgendaCalendar({
  events,
  initialMonth,
}: {
  events: PublicEvent[];
  initialMonth: string;
}) {
  const [visibleMonth, setVisibleMonth] = useState(() => parseMonthKey(initialMonth));
  const visibleMonthKey = monthKey(visibleMonth);
  const todayKey = dateKey(new Date());
  const calendarDays = useMemo(() => buildCalendarDays(visibleMonth), [visibleMonth]);
  const eventsByDate = useMemo(() => {
    const grouped = new Map<string, PublicEvent[]>();

    for (const event of events) {
      const key = dateKey(event.startsAt);
      grouped.set(key, [...(grouped.get(key) ?? []), event]);
    }

    return grouped;
  }, [events]);

  function moveMonth(offset: number) {
    setVisibleMonth((current) => new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + offset, 1)));
  }

  function showCurrentMonth() {
    setVisibleMonth(parseMonthKey(initialMonth));
  }

  return (
    <section className={styles.calendarSection} id="calendario" aria-labelledby="calendar-title">
      <div className={styles.calendarHeading}>
        <div>
          <p className={styles.calendarEyebrow}>Calendario mensual</p>
          <h2 id="calendar-title">{formatMonth(visibleMonth)}</h2>
        </div>
        <div className={styles.calendarControls} aria-label="Cambiar mes">
          <button type="button" onClick={() => moveMonth(-1)} aria-label="Mes anterior">‹</button>
          <button
            type="button"
            className={visibleMonthKey === initialMonth ? styles.calendarTodayActive : undefined}
            onClick={showCurrentMonth}
          >
            Hoy
          </button>
          <button type="button" onClick={() => moveMonth(1)} aria-label="Mes siguiente">›</button>
        </div>
      </div>

      <div className={styles.calendarLegend} aria-label="Referencias del calendario">
        <span><i className={styles.legendUpcoming} /> Próximos encuentros</span>
        <span><i className={styles.legendPast} /> Actividades anteriores</span>
      </div>

      <div className={styles.calendarWeekdays} role="row">
        {WEEKDAYS.map((weekday) => <span key={weekday} role="columnheader">{weekday}</span>)}
      </div>
      <div className={styles.calendarGrid} role="grid" aria-label={`Agenda de ${formatMonth(visibleMonth)}`}>
        {calendarDays.map((calendarDay) => {
          const dayEvents = calendarDay.isOutside ? [] : eventsByDate.get(calendarDay.dateKey) ?? [];
          const dayClassName = [
            styles.calendarCell,
            calendarDay.isOutside && styles.calendarCellOutside,
            calendarDay.dateKey === todayKey && styles.calendarCellToday,
            dayEvents.length > 0 && styles.calendarCellHasEvents,
          ]
            .filter(Boolean)
            .join(" ");

          return (
            <div className={dayClassName} key={calendarDay.dateKey} role="gridcell">
              <span className={styles.calendarDate}>{calendarDay.day}</span>
              <div className={styles.calendarCellEvents}>
                {dayEvents.slice(0, 2).map((event) => (
                  <Link
                    className={`${styles.calendarEvent} ${toneClasses[event.tone]}`}
                    href={`/eventos/${event.slug}`}
                    key={event.id}
                    title={event.title}
                    aria-label={`${event.title}, ${event.kindLabel}`}
                  >
                    <i className={styles.calendarEventDot} />
                    <span>{event.title}</span>
                  </Link>
                ))}
                {dayEvents.length > 2 ? <span className={styles.moreEvents}>+{dayEvents.length - 2} más</span> : null}
              </div>
            </div>
          );
        })}
      </div>

      {events.length === 0 ? (
        <div className={styles.calendarEmpty}>
          <span>—</span>
          <p>El calendario se llenará cuando el club publique sus próximas actividades.</p>
        </div>
      ) : null}
    </section>
  );
}
