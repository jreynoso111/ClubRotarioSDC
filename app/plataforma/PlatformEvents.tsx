"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { FormEvent, ReactNode } from "react";
import type { PlatformEvent, PlatformSnapshot } from "@/lib/platform";
import {
  createEventAction, updateEventAction, deleteEventAction, getEventAttendeesAction, rsvpEventAction,
  type EventInput, type EventAttendee, type PlatformActionResult,
} from "./actions";
import styles from "./platform.module.css";

const kindLabels: Record<string, string> = {
  encuentro: "Encuentro", servicio: "Servicio", plataforma: "Plataforma", reunion: "Reunión", otro: "Otra actividad",
};
const eventStatusLabels: Record<string, string> = {
  draft: "Borrador", published: "Publicado", cancelled: "Cancelado", archived: "Archivado",
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("es-DO", {
    dateStyle: "medium", timeStyle: "short", timeZone: "America/Santo_Domingo",
  }).format(new Date(value));
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

function eventDate(value: FormDataEntryValue | null) {
  // datetime-local fields represent Santo Domingo time, regardless of the browser's time zone.
  return value ? `${String(value)}-04:00` : "";
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

function Feedback({ result }: { result: PlatformActionResult | null }) {
  return result ? <p className={result.ok ? styles.feedbackSuccess : styles.feedbackError} role={result.ok ? "status" : "alert"}>{result.message}</p> : null;
}

function EventForm({ event, canPublish, pending, feedback, onSave, onClose }: {
  event?: PlatformEvent; canPublish: boolean; pending: boolean; feedback: PlatformActionResult | null;
  onSave: (input: EventInput) => void; onClose: () => void;
}) {
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
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
    <label>Título<input name="title" required minLength={3} maxLength={160} defaultValue={event?.title} /></label>
    <label>Tipo<select name="kind" defaultValue={event?.kind ?? "encuentro"}>
      {Object.entries(kindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </select></label>
    <div className={styles.eventFormDates}>
      <label>Inicio<input name="startsAt" type="datetime-local" required defaultValue={localDate(event?.startsAt ?? null)} /></label>
      <label>Fin<input name="endsAt" type="datetime-local" defaultValue={localDate(event?.endsAt ?? null)} /></label>
    </div>
    <p className={styles.empty}>Fechas y horas de Santo Domingo.</p>
    <label>Lugar<input name="venueName" maxLength={180} defaultValue={event?.venueName ?? ""} /></label>
    <label>Dirección<input name="venueAddress" maxLength={300} defaultValue={event?.venueAddress ?? ""} /></label>
    <label>Enlace de ubicación<input name="locationUrl" type="url" maxLength={500} defaultValue={event?.locationUrl ?? ""} /></label>
    <label>Capacidad<input name="capacity" type="number" min={0} step={1} defaultValue={event?.capacity ?? ""} /></label>
    <label>Resumen<textarea name="summary" maxLength={600} defaultValue={event?.summary ?? ""} /></label>
    <label>Descripción<textarea name="description" maxLength={8000} defaultValue={event?.description ?? ""} /></label>
    <label>Estado<select name="status" defaultValue={event?.status ?? (canPublish ? "published" : "draft")}>
      <option value="draft">Borrador</option>
      {(canPublish || event?.status === "published") && <option value="published">Publicado para miembros</option>}
      {event && <><option value="cancelled">Cancelado</option><option value="archived">Archivado</option></>}
    </select></label>
    <label className={styles.check}><input name="isPublic" type="checkbox" defaultChecked={event?.isPublic ?? false} /> Mostrar también en la agenda pública</label>
    <p className={styles.empty}>Los miembros pueden confirmar asistencia a los eventos publicados. Los borradores quedan para el equipo de gestión.</p>
    <div className={styles.eventDialogActions}>
      <button type="button" className={styles.buttonQuiet} onClick={onClose} disabled={pending}>Cancelar</button>
      <button className={styles.button} disabled={pending}>{pending ? "Guardando…" : event ? "Guardar cambios" : "Crear evento"}</button>
    </div>
  </form>;
}

type DialogState =
  | { kind: "editor"; event?: PlatformEvent }
  | { kind: "delete"; event: PlatformEvent }
  | { kind: "attendees"; event: PlatformEvent; attendees: EventAttendee[] | null; error?: string };

export function PlatformEvents({ snapshot, summary = false, onOpenAgenda }: {
  snapshot: PlatformSnapshot; summary?: boolean; onOpenAgenda?: () => void;
}) {
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [feedback, setFeedback] = useState<PlatformActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const canEditEvents = snapshot.capabilities.canCoordinate || snapshot.capabilities.canEdit;
  const canDeleteEvents = snapshot.capabilities.canManageClub;
  const canViewAttendees = snapshot.capabilities.canCoordinate;
  const events = summary
    ? snapshot.events.filter(event => !event.isPast && event.status === "published").slice(0, 4)
    : snapshot.events;

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
    setDialog({ kind: "attendees", event, attendees: null });
    startTransition(async () => {
      try {
        const result = await getEventAttendeesAction(event.id);
        setDialog(current => current?.kind === "attendees" && current.event.id === event.id
          ? { ...current, attendees: result.ok ? result.attendees ?? [] : null, error: result.ok ? undefined : result.message }
          : current);
      } catch {
        setDialog(current => current?.kind === "attendees" && current.event.id === event.id
          ? { ...current, error: "No se pudo cargar la lista de asistencia. Cierra e inténtalo de nuevo." }
          : current);
      }
    });
  }

  return <article className={`${styles.card} ${styles.cardWide}`}>
    <div className={styles.eventPanelHeader}>
      <div><p className={styles.cardLabel}>{summary ? "Próximos encuentros" : "Agenda interna"}</p>
        <h2 className={styles.cardTitle}>{summary ? "La agenda del club." : "Tiempo compartido, acción posible."}</h2></div>
      {canEditEvents && <button type="button" className={styles.smallButton} disabled={pending} onClick={() => openEditor()}>Nuevo evento</button>}
    </div>
    {!dialog && <Feedback result={feedback} />}
    {events.map(event => {
      const rsvp = snapshot.eventRsvps[event.id];
      const openForAttendance = event.status === "published" && !event.isPast;
      return <section key={event.id} className={styles.eventRow} aria-label={event.title}>
        <div className={styles.eventDetails}>
          <span className={styles.eventMeta}>{event.isPast && event.status === "published" ? "Finalizado" : eventStatusLabels[event.status]} · {kindLabels[event.kind]}</span>
          <h3>{event.title}</h3>
          <time dateTime={event.startsAt}>{formatDate(event.startsAt)}</time>
          <p>{[event.venueName, event.venueAddress].filter(Boolean).join(" · ") || "Lugar por confirmar"}</p>
          {!summary && event.summary && <p>{event.summary}</p>}
        </div>
        {openForAttendance && <div className={styles.eventAttendanceActions}>
          {rsvp === "going" ? <span className={styles.attendanceConfirmed}>Asistencia confirmada</span>
            : <button type="button" className={styles.smallButton} disabled={pending} onClick={() => run(() => rsvpEventAction(event.id, "going"))}>Confirmar asistencia</button>}
          {rsvp === "maybe" && <span className={styles.eventMeta}>Quizá asistirás</span>}
          {rsvp === "declined" && <span className={styles.eventMeta}>No asistirás</span>}
          {rsvp !== "going" && rsvp !== "maybe" && <button type="button" className={styles.smallButtonQuiet} disabled={pending} onClick={() => run(() => rsvpEventAction(event.id, "maybe"))}>Quizá asista</button>}
          {(rsvp === "going" || rsvp === "maybe") && <button type="button" className={styles.smallButtonQuiet} disabled={pending} onClick={() => run(() => rsvpEventAction(event.id, "declined"))}>Cancelar mi asistencia</button>}
        </div>}
        {(canEditEvents || canViewAttendees) && <div className={styles.eventManageActions}>
          {canViewAttendees && <button type="button" className={styles.smallButtonQuiet} disabled={pending} onClick={() => openAttendees(event)} aria-label={`Ver asistentes de ${event.title}`}>Ver asistentes</button>}
          {canEditEvents && <button type="button" className={styles.smallButtonQuiet} disabled={pending} onClick={() => openEditor(event)} aria-label={`Editar ${event.title}`}>Editar</button>}
          {canDeleteEvents && <button type="button" className={`${styles.smallButtonQuiet} ${styles.eventDeleteButton}`} disabled={pending} onClick={() => { setFeedback(null); setDialog({ kind: "delete", event }); }} aria-label={`Eliminar ${event.title}`}>Eliminar</button>}
        </div>}
      </section>;
    })}
    {events.length === 0 && <p className={styles.empty}>{summary ? "No hay próximos eventos publicados." : "Todavía no hay eventos en la agenda."}</p>}
    {summary && onOpenAgenda && <button type="button" className={styles.eventAgendaLink} onClick={onOpenAgenda}>Ver toda la agenda →</button>}
    {dialog?.kind === "editor" && <EventDialog title={dialog.event ? "Editar evento" : "Nuevo evento"} onClose={() => setDialog(null)}>
      <EventForm event={dialog.event} canPublish={snapshot.capabilities.canEdit} pending={pending} feedback={feedback}
        onClose={() => setDialog(null)} onSave={input => run(() => dialog.event ? updateEventAction(dialog.event.id, input) : createEventAction(input), true)} />
    </EventDialog>}
    {dialog?.kind === "delete" && <EventDialog title="Eliminar evento" onClose={() => setDialog(null)}>
      <div className={styles.eventDialogBody}><p><strong>{dialog.event.title}</strong></p>
        <p>Se eliminarán el evento y sus confirmaciones de asistencia. Esta acción no se puede deshacer.</p>
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
          <button type="button" className={styles.smallButtonQuiet} disabled={pending} onClick={() => openAttendees(dialog.event)}>Actualizar lista</button>
        </div>
        {dialog.error ? <p role="alert" className={styles.feedbackError}>{dialog.error}</p>
          : dialog.attendees === null ? <p role="status">Cargando asistentes…</p>
          : <>
            <p className={styles.attendanceTotal}>{dialog.attendees.filter(person => person.status === "going").length} {dialog.attendees.filter(person => person.status === "going").length === 1 ? "asistente confirmado" : "asistentes confirmados"}</p>
            {([ ["going", "Confirmados"], ["maybe", "Por confirmar"], ["declined", "No asistirán"] ] as const).map(([status, label]) => {
              const group = dialog.attendees!.filter(person => person.status === status);
              return <section className={styles.attendanceGroup} key={status}>
                <h3>{label} <span>{group.length}</span></h3>
                {group.length > 0 ? <ul>{group.map(person => <li key={person.userId}>{person.name}</li>)}</ul>
                  : <p className={styles.empty}>{status === "going" ? "Aún no hay miembros con asistencia confirmada." : "Sin respuestas en este grupo."}</p>}
              </section>;
            })}
          </>}
      </div>
    </EventDialog>}
  </article>;
}
