"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { FormEvent, ReactNode } from "react";
import type { PlatformEvent, PlatformEventCounts, PlatformSnapshot } from "@/lib/platform";
import {
  createEventAction, updateEventAction, deleteEventAction, getEventAttendeesAction, rsvpEventAction,
  getEventAttendanceRecordAction, saveEventAttendanceAction,
  type EventInput, type EventAttendee, type EventAttendanceCounts, type PlatformActionResult,
} from "./actions";
import { formatClubDate } from "@/lib/club-date";
import { downloadIcs } from "@/lib/ics";
import styles from "./platform.module.css";

const kindLabels: Record<string, string> = {
  encuentro: "Encuentro", servicio: "Servicio", plataforma: "Plataforma", reunion: "Reunión", otro: "Otra actividad",
};
const eventStatusLabels: Record<string, string> = {
  draft: "Borrador", published: "Publicado", cancelled: "Cancelado", archived: "Archivado",
};
type View = "upcoming" | "history" | "drafts" | "cancelled";
const views: Array<{ id: View; label: string; coordinationOnly?: boolean }> = [
  { id: "upcoming", label: "Próximos" }, { id: "history", label: "Historial" },
  { id: "drafts", label: "Borradores", coordinationOnly: true }, { id: "cancelled", label: "Cancelados" },
];

function inView(event: PlatformEvent, view: View) {
  if (view === "drafts") return event.status === "draft";
  if (view === "cancelled") return event.status === "cancelled";
  if (view === "history") return event.isPast && (event.status === "published" || event.status === "archived");
  return !event.isPast && event.status === "published";
}

// "28 nov 2026, 9:00 a. m. – 12:00 p. m." or two full dates when it spans days.
function formatRange(event: PlatformEvent) {
  const start = formatClubDate(event.startsAt);
  if (!event.endsAt) return start;
  const end = formatClubDate(event.endsAt);
  const sameDay = formatClubDate(event.startsAt, false) === formatClubDate(event.endsAt, false);
  return sameDay ? `${start} – ${end.split(", ")[1]}` : `${start} – ${end}`;
}

function localDate(value: string | null) {
  if (!value) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santo_Domingo", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(value));
  const fields = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${fields.year}-${fields.month}-${fields.day}T${fields.hour}:${fields.minute}`;
}

function isPast(local: string) {
  return Boolean(local) && new Date(`${local}-04:00`).getTime() < Date.now();
}

function eventDate(value: FormDataEntryValue | null) {
  // datetime-local fields represent Santo Domingo time, regardless of the browser's time zone.
  return value ? `${String(value)}-04:00` : "";
}

function occupancy(event: PlatformEvent, counts: PlatformEventCounts | undefined) {
  if (!counts) return null;
  const parts = [event.capacity === null ? `${counts.going} ${counts.going === 1 ? "confirmado" : "confirmados"}` : `${counts.going} de ${event.capacity} plazas ocupadas`];
  if (counts.waitlisted) parts.push(`${counts.waitlisted} en espera`);
  if (counts.maybe) parts.push(`${counts.maybe} quizá`);
  return parts.join(" · ");
}

function EventDialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return <dialog ref={ref} className={styles.eventDialog} aria-labelledby="event-dialog-title" onCancel={onClose}>
    <div className={styles.eventDialogHeader}>
      <h2 id="event-dialog-title">{title}</h2>
      <button type="button" className={styles.smallButtonQuiet} onClick={onClose} aria-label="Cerrar ventana">Cerrar</button>
    </div>
    {children}
  </dialog>;
}

function Feedback({ result, pending = false }: { result: PlatformActionResult | null; pending?: boolean }) {
  // A success waits for the refreshed agenda so the message never contradicts the cards.
  if (pending && result?.ok) return <p className={styles.feedbackSuccess} role="status">Actualizando la agenda…</p>;
  return result ? <p className={result.ok ? styles.feedbackSuccess : styles.feedbackError} role={result.ok ? "status" : "alert"}>{result.message}</p> : null;
}

function EventForm({ event, pending, feedback, onSave, onClose }: {
  event?: PlatformEvent; pending: boolean; feedback: PlatformActionResult | null;
  onSave: (input: EventInput) => void; onClose: () => void;
}) {
  const [startsAt, setStartsAt] = useState(localDate(event?.startsAt ?? null));
  const [isPastDate, setIsPastDate] = useState(() => isPast(localDate(event?.startsAt ?? null)));
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (isPastDate && !window.confirm("La fecha de inicio ya pasó. ¿Guardar el evento como un registro de algo que ya ocurrió?")) return;
    const data = new FormData(e.currentTarget);
    onSave({
      title: String(data.get("title") ?? ""), kind: String(data.get("kind") ?? "encuentro"),
      summary: String(data.get("summary") ?? ""), description: String(data.get("description") ?? ""),
      startsAt: eventDate(data.get("startsAt")), endsAt: eventDate(data.get("endsAt")),
      venueName: String(data.get("venueName") ?? ""), venueAddress: String(data.get("venueAddress") ?? ""),
      locationUrl: String(data.get("locationUrl") ?? ""), capacity: String(data.get("capacity") ?? ""),
      status: String(data.get("status")) as EventInput["status"], isPublic: data.get("isPublic") === "on",
    });
  }
  return <form className={`${styles.formCard} ${styles.eventForm}`} onSubmit={submit}>
    <Feedback result={feedback} />
    <div className={styles.eventFormStatus}>
      <label>Estado<select name="status" defaultValue={event?.status ?? "draft"}>
        <option value="draft">Borrador (solo coordinación)</option>
        <option value="published">Publicado para miembros</option>
        {event && <><option value="cancelled">Cancelado</option><option value="archived">Archivado</option></>}
      </select></label>
      <label className={styles.check}><input name="isPublic" type="checkbox" defaultChecked={event?.isPublic ?? false} /> Mostrar también en la agenda pública</label>
    </div>
    <p className={styles.empty}>Al publicar, los miembros reciben un aviso. Si cambias la fecha o el lugar, o lo cancelas, se avisa a quienes respondieron.</p>
    <label>Título<input name="title" required minLength={3} maxLength={160} defaultValue={event?.title} /></label>
    <label>Tipo<select name="kind" defaultValue={event?.kind ?? "encuentro"}>
      {Object.entries(kindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </select></label>
    <div className={styles.eventFormDates}>
      <label>Inicio<input name="startsAt" type="datetime-local" required value={startsAt} onChange={e => { setStartsAt(e.target.value); setIsPastDate(isPast(e.target.value)); }} /></label>
      <label>Fin<input name="endsAt" type="datetime-local" defaultValue={localDate(event?.endsAt ?? null)} /></label>
    </div>
    {isPastDate ? <p className={styles.eventPastWarning} role="status">Esta fecha ya pasó. Puedes guardarlo para registrar un evento que ya ocurrió; no admitirá confirmaciones.</p>
      : <p className={styles.empty}>Fechas y horas de Santo Domingo.</p>}
    <label>Lugar<input name="venueName" maxLength={180} defaultValue={event?.venueName ?? ""} /></label>
    <label>Dirección<input name="venueAddress" maxLength={300} defaultValue={event?.venueAddress ?? ""} /></label>
    <label>Enlace de ubicación<input name="locationUrl" type="url" maxLength={500} defaultValue={event?.locationUrl ?? ""} placeholder="https://maps…" /></label>
    <label>Capacidad<input name="capacity" type="number" min={0} step={1} defaultValue={event?.capacity ?? ""} placeholder="Sin límite" /></label>
    <p className={styles.empty}>Con capacidad, las confirmaciones adicionales pasan a lista de espera y avanzan solas cuando se libera una plaza.</p>
    <label>Resumen<textarea name="summary" maxLength={600} defaultValue={event?.summary ?? ""} /></label>
    <label>Descripción<textarea name="description" maxLength={8000} defaultValue={event?.description ?? ""} /></label>
    <div className={styles.eventDialogActions}>
      <button type="button" className={styles.buttonQuiet} onClick={onClose} disabled={pending}>Cancelar</button>
      <button className={styles.button} disabled={pending}>{pending ? "Guardando…" : event ? "Guardar cambios" : "Crear evento"}</button>
    </div>
  </form>;
}

type DialogState =
  | { kind: "editor"; event?: PlatformEvent }
  | { kind: "delete"; event: PlatformEvent }
  | { kind: "attendees"; event: PlatformEvent; attendees: EventAttendee[] | null; counts?: EventAttendanceCounts | PlatformEventCounts; error?: string }
  | { kind: "record"; event: PlatformEvent; attended: Set<string> | null; error?: string };

export function PlatformEvents({ snapshot, summary = false, onOpenAgenda }: {
  snapshot: PlatformSnapshot; summary?: boolean; onOpenAgenda?: () => void;
}) {
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [feedback, setFeedback] = useState<PlatformActionResult | null>(null);
  const [view, setView] = useState<View>("upcoming");
  const [pending, startTransition] = useTransition();
  // Coordination runs the agenda; editors run the magazine.
  const canManageEvents = snapshot.capabilities.canCoordinate;
  const canDeleteEvents = snapshot.capabilities.canManageClub;
  const events = summary
    ? snapshot.events.filter(event => inView(event, "upcoming")).slice(0, 4)
    : snapshot.events.filter(event => inView(event, view))
      .sort((a, b) => view === "upcoming" || view === "drafts" ? a.startsAt.localeCompare(b.startsAt) : b.startsAt.localeCompare(a.startsAt));

  function run(action: () => Promise<PlatformActionResult>, closeOnSuccess = false) {
    setFeedback(null);
    startTransition(async () => {
      try {
        const result = await action();
        setFeedback(result);
        if (result.ok && closeOnSuccess) setDialog(null);
      } catch {
        setFeedback({ ok: false, message: "No se pudo completar la acción. Inténtalo de nuevo." });
      }
    });
  }

  function openEditor(event?: PlatformEvent) {
    setFeedback(null);
    setDialog({ kind: "editor", event });
  }

  function openAttendees(event: PlatformEvent) {
    setFeedback(null);
    const attendance = snapshot.eventAttendance[event.id] ?? [];
    const counts = snapshot.eventCounts[event.id];
    if (!canManageEvents) { setDialog({ kind: "attendees", event, attendees: attendance, counts }); return; }
    setDialog({ kind: "attendees", event, attendees: null });
    startTransition(async () => {
      try {
        const result = await getEventAttendeesAction(event.id);
        setDialog(current => current?.kind === "attendees" && current.event.id === event.id
          ? { ...current, attendees: result.ok ? result.attendees ?? [] : null, counts: result.counts, error: result.ok ? undefined : result.message }
          : current);
      } catch {
        setDialog(current => current?.kind === "attendees" && current.event.id === event.id
          ? { ...current, error: "No se pudo cargar la lista de asistencia. Cierra e inténtalo de nuevo." }
          : current);
      }
    });
  }

  function openRecord(event: PlatformEvent) {
    setFeedback(null);
    setDialog({ kind: "record", event, attended: null });
    startTransition(async () => {
      try {
        const result = await getEventAttendanceRecordAction(event.id);
        // Until coordination saves a record, start from the confirmed list.
        const confirmed = (snapshot.eventAttendance[event.id] ?? []).filter(person => person.status === "going").map(person => person.userId);
        const initial = result.ok && result.attendedIds && result.attendedIds.length > 0 ? result.attendedIds : confirmed;
        setDialog(current => current?.kind === "record" && current.event.id === event.id
          ? { ...current, attended: result.ok ? new Set(initial) : null, error: result.ok ? undefined : result.message } : current);
      } catch {
        setDialog(current => current?.kind === "record" && current.event.id === event.id
          ? { ...current, error: "No se pudo cargar la asistencia. Cierra e inténtalo de nuevo." } : current);
      }
    });
  }

  return <article className={`${styles.card} ${styles.cardWide}`}>
    <div className={styles.eventPanelHeader}>
      <div><p className={styles.cardLabel}>{summary ? "Próximos encuentros" : "Agenda interna"}</p>
        <h2 className={styles.cardTitle}>{summary ? "La agenda del club." : "Tiempo compartido, acción posible."}</h2></div>
      {canManageEvents && <button type="button" className={styles.smallButton} disabled={pending} onClick={() => openEditor()}>Nuevo evento</button>}
    </div>
    {!summary && <div className={styles.proposalFilters} role="group" aria-label="Filtrar eventos">
      {views.filter(item => !item.coordinationOnly || canManageEvents).map(item => {
        const count = snapshot.events.filter(event => inView(event, item.id)).length;
        return <button type="button" key={item.id} aria-pressed={view === item.id}
          className={view === item.id ? styles.proposalFilterActive : styles.proposalFilter}
          onClick={() => setView(item.id)}>{item.label} <span>{count}</span></button>;
      })}
    </div>}
    {!dialog && <Feedback result={feedback} pending={pending} />}
    {events.map(event => {
      const rsvp = snapshot.eventRsvps[event.id];
      const counts = snapshot.eventCounts[event.id];
      const cancelled = event.status === "cancelled";
      const openForAttendance = event.status === "published" && !event.isPast;
      const rowState = cancelled ? styles.eventRowCancelled : !openForAttendance ? "" : rsvp === "going" ? styles.eventRowGoing
        : rsvp === "declined" ? styles.eventRowDeclined : styles.eventRowUpcoming;
      const rowClass = rowState ? `${styles.eventRow} ${rowState}` : styles.eventRow;
      const respond = (status: "going" | "maybe" | "declined") => run(() => rsvpEventAction(event.id, status));
      const place = [event.venueName, event.venueAddress].filter(Boolean).join(" · ");
      const occupied = occupancy(event, counts);
      return <section key={event.id} className={rowClass} aria-label={event.title}>
        <div className={styles.eventDetails}>
          <span className={styles.eventMeta}>{event.isPast && event.status === "published" ? "Finalizado" : eventStatusLabels[event.status]} · {kindLabels[event.kind]}{canManageEvents && event.isPublic ? " · En la agenda pública" : ""}</span>
          <h3>{event.title}</h3>
          <time dateTime={event.startsAt}>{formatRange(event)}</time>
          <p>{place || "Lugar por confirmar"}{event.locationUrl ? <> · <a href={event.locationUrl} target="_blank" rel="noreferrer">Cómo llegar ↗</a></> : null}</p>
          {!summary && event.summary && <p>{event.summary}</p>}
          {!summary && event.description ? <details className={styles.eventMore}><summary>Más detalles</summary><p>{event.description}</p></details> : null}
          {cancelled ? <p className={styles.eventCancelledNotice}>Este evento fue cancelado.{rsvp && rsvp !== "declined" ? " Tu respuesta ya no aplica." : ""}</p> : null}
        </div>
        {openForAttendance && <div className={styles.eventAttendanceActions}>
          <span className={rsvp === "going" ? styles.rsvpGoing : rsvp === "declined" ? styles.rsvpDeclined : styles.rsvpPending}>
            {rsvp === "going" ? "Asistirás" : rsvp === "waitlisted" ? "En lista de espera" : rsvp === "declined" ? "No asistirás" : rsvp === "maybe" ? "Quizá asistas" : "Pendiente de respuesta"}
          </span>
          {rsvp !== "going" && rsvp !== "waitlisted" && <button type="button" className={styles.smallButton} disabled={pending} onClick={() => respond("going")}>
            {event.capacity !== null && counts && counts.going >= event.capacity ? "Unirme a la lista de espera" : "Confirmar asistencia"}</button>}
          {rsvp !== "maybe" && <button type="button" className={styles.smallButtonQuiet} disabled={pending} onClick={() => respond("maybe")}>Quizá</button>}
          {rsvp !== "declined" && <button type="button" className={styles.smallButtonQuiet} disabled={pending} onClick={() => respond("declined")}>{rsvp === "waitlisted" ? "Salir de la lista" : "No asistiré"}</button>}
          <button type="button" className={styles.smallButtonQuiet} onClick={() => downloadIcs({
            id: event.id, title: event.title, startsAt: event.startsAt, endsAt: event.endsAt, location: place || null,
            description: [event.summary, event.locationUrl].filter(Boolean).join("\n") || null,
          }, event.title.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-"))}>Agregar a mi calendario</button>
        </div>}
        {(event.status === "published" || cancelled) && <div className={styles.eventAttendees}>
          <button type="button" className={styles.eventAttendeesToggle} disabled={pending || !counts}
            onClick={() => openAttendees(event)}>
            {occupied ?? "Cargando asistencia…"}{counts && counts.going + counts.waitlisted + counts.maybe > 0 ? " · Ver lista" : ""}
          </button>
          {canManageEvents && event.isPast && event.status === "published" && counts?.attended !== null && counts?.attended !== undefined
            ? <span className={styles.eventAttendedCount}>Asistieron {counts.attended}</span> : null}
        </div>}
        {canManageEvents && <div className={styles.eventManageActions}>
          {event.isPast && event.status === "published" && <button type="button" className={styles.smallButtonQuiet} disabled={pending} onClick={() => openRecord(event)}>Registrar asistencia</button>}
          <button type="button" className={styles.smallButtonQuiet} disabled={pending} onClick={() => openEditor(event)} aria-label={`Editar ${event.title}`}>Editar</button>
          {canDeleteEvents && <button type="button" className={`${styles.smallButtonQuiet} ${styles.eventDeleteButton}`} disabled={pending} onClick={() => { setFeedback(null); setDialog({ kind: "delete", event }); }} aria-label={`Eliminar ${event.title}`}>Eliminar</button>}
        </div>}
      </section>;
    })}
    {events.length === 0 && <p className={styles.empty}>{summary ? "No hay próximos eventos publicados."
      : view === "upcoming" ? "No hay próximos eventos publicados." : view === "history" ? "Todavía no hay eventos pasados."
      : view === "drafts" ? "No hay borradores." : "No hay eventos cancelados."}</p>}
    {summary && onOpenAgenda && <button type="button" className={styles.eventAgendaLink} onClick={onOpenAgenda}>Ver toda la agenda →</button>}
    {dialog?.kind === "editor" && <EventDialog title={dialog.event ? "Editar evento" : "Nuevo evento"} onClose={() => setDialog(null)}>
      <EventForm event={dialog.event} pending={pending} feedback={feedback}
        onClose={() => setDialog(null)} onSave={input => run(() => dialog.event ? updateEventAction(dialog.event.id, input) : createEventAction(input), true)} />
    </EventDialog>}
    {dialog?.kind === "delete" && <EventDialog title="Eliminar evento" onClose={() => setDialog(null)}>
      <div className={styles.eventDialogBody}><p><strong>{dialog.event.title}</strong></p>
        <p>Se eliminarán el evento, sus confirmaciones y su registro de asistencia. Esta acción no se puede deshacer. Si el evento no se realizará, es mejor marcarlo como cancelado: así se avisa a quienes respondieron.</p>
        <Feedback result={feedback} />
        <div className={styles.eventDialogActions}>
          <button type="button" className={styles.buttonQuiet} disabled={pending} onClick={() => setDialog(null)}>Conservar evento</button>
          <button type="button" className={`${styles.button} ${styles.eventDeleteConfirm}`} disabled={pending} onClick={() => run(() => deleteEventAction(dialog.event.id), true)}>{pending ? "Eliminando…" : "Eliminar evento"}</button>
        </div>
      </div>
    </EventDialog>}
    {dialog?.kind === "attendees" && <EventDialog title="Lista de asistencia" onClose={() => setDialog(null)}>
      <div className={styles.eventDialogBody}>
        <div className={styles.attendanceHeader}><p className={styles.attendanceEventTitle}>{dialog.event.title}</p>
          {canManageEvents && <button type="button" className={styles.smallButtonQuiet} disabled={pending} onClick={() => openAttendees(dialog.event)}>Actualizar lista</button>}
        </div>
        {dialog.error ? <p role="alert" className={styles.feedbackError}>{dialog.error}</p>
          : dialog.attendees === null ? <p role="status">Cargando asistentes…</p>
          : <>
            <p className={styles.attendanceTotal}>{occupancy(dialog.event, dialog.counts as PlatformEventCounts | undefined) ?? ""}</p>
            {([["going", "Confirmados"], ["waitlisted", "En lista de espera"], ["maybe", "Quizá asistan"]] as const).map(([status, label]) => {
              const group = dialog.attendees!.filter(person => person.status === status);
              if (status === "waitlisted" && group.length === 0) return null;
              return <section className={styles.attendanceGroup} key={status}>
                <h3>{label} <span>{group.length}</span></h3>
                {group.length > 0 ? (status === "waitlisted" ? <ol>{group.map(person => <li key={person.userId}>{person.name}</li>)}</ol>
                  : <ul>{group.map(person => <li key={person.userId}>{person.name}</li>)}</ul>)
                  : <p className={styles.empty}>{status === "going" ? "Aún no hay miembros con asistencia confirmada." : "Sin respuestas en este grupo."}</p>}
              </section>;
            })}
            {dialog.counts ? <p className={styles.empty}>{dialog.counts.declined} {dialog.counts.declined === 1 ? "persona no asistirá" : "personas no asistirán"} · {dialog.counts.unanswered} {dialog.counts.unanswered === 1 ? "miembro no ha respondido" : "miembros no han respondido"}.</p> : null}
          </>}
      </div>
    </EventDialog>}
    {dialog?.kind === "record" && <EventDialog title="Registrar asistencia" onClose={() => setDialog(null)}>
      <div className={styles.eventDialogBody}>
        <p className={styles.attendanceEventTitle}>{dialog.event.title} · {formatRange(dialog.event)}</p>
        {dialog.error ? <p role="alert" className={styles.feedbackError}>{dialog.error}</p>
          : dialog.attended === null ? <p role="status">Cargando asistencia…</p>
          : <form onSubmit={e => { e.preventDefault(); const ids = [...dialog.attended!]; run(() => saveEventAttendanceAction(dialog.event.id, ids), true); }}>
            <p className={styles.empty}>Marca quién asistió realmente. Se usa para las estadísticas de participación del club.</p>
            <div className={styles.attendanceChecklist}>{snapshot.memberDirectory.map(member => <label key={member.userId} className={styles.check}>
              <input type="checkbox" checked={dialog.attended!.has(member.userId)} onChange={e => {
                const next = new Set(dialog.attended);
                if (e.target.checked) next.add(member.userId); else next.delete(member.userId);
                setDialog({ ...dialog, attended: next });
              }} /> {member.name}</label>)}</div>
            <Feedback result={feedback} />
            <div className={styles.eventDialogActions}>
              <button type="button" className={styles.buttonQuiet} disabled={pending} onClick={() => setDialog(null)}>Cancelar</button>
              <button className={styles.button} disabled={pending}>{pending ? "Guardando…" : `Guardar asistencia (${dialog.attended.size})`}</button>
            </div>
          </form>}
      </div>
    </EventDialog>}
  </article>;
}
