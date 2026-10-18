"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import { formatClubDate } from "@/lib/club-date";
import {
  membershipApplicationNoteMaxLength,
  membershipApplicationPageSize,
  membershipApplicationReasonRange,
  membershipApplicationSearchMaxLength,
  membershipApplicationStatuses,
  membershipApplicationStatusLabels,
  membershipDecisionReasonError,
  type MembershipApplicationHistoryEntry,
  type MembershipApplicationListItem,
  type MembershipApplicationNote,
  type MembershipApplicationStatus,
} from "@/lib/membership-applications";

import type { MembershipApplicationDetailResult, MembershipApplicationsActionResult, PlatformActionResult } from "./actions";
import styles from "./platform.module.css";

type StatusFilter = MembershipApplicationStatus | "all";
type ListQuery = { status: StatusFilter; search: string; page: number };
type ListData = { applications: MembershipApplicationListItem[]; total: number; canManage: boolean };
type Notice = { message: string; isError: boolean };
type DetailState = { notes: MembershipApplicationNote[]; history: MembershipApplicationHistoryEntry[] };

type Props = {
  loadApplications: (input: ListQuery) => Promise<MembershipApplicationsActionResult>;
  reviewApplication: (
    applicationId: string,
    status: MembershipApplicationStatus,
    reason: string | null,
    expectedUpdatedAt: string,
  ) => Promise<PlatformActionResult>;
  loadDetail: (applicationId: string) => Promise<MembershipApplicationDetailResult>;
  addNote: (applicationId: string, body: string) => Promise<PlatformActionResult>;
};

const statusOptions: StatusFilter[] = ["all", ...membershipApplicationStatuses];
const statusFilterLabels: Record<StatusFilter, string> = { all: "Todas", ...membershipApplicationStatusLabels };

function countLabel(total: number) {
  return `${total} ${total === 1 ? "solicitud" : "solicitudes"}`;
}

export function MembershipApplicationsModule({ loadApplications, reviewApplication, loadDetail, addNote }: Props) {
  const [query, setQuery] = useState<ListQuery>({ status: "all", search: "", page: 1 });
  const [searchDraft, setSearchDraft] = useState("");
  const [data, setData] = useState<ListData | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const latest = useRef(0);

  // Only the newest request may update the list, so an older response cannot overwrite a newer filter.
  const requestList = useCallback((next: ListQuery) => {
    const request = ++latest.current;
    return loadApplications(next).then(result => {
      if (request !== latest.current) return false;
      if (result.ok) {
        setData({ applications: result.applications, total: result.total, canManage: result.canManage });
        if (result.page !== next.page) setQuery(current => ({ ...current, page: result.page }));
      } else {
        setData(null);
        setNotice({ message: result.message, isError: true });
      }
      setLoading(false);
      return result.ok;
    }).catch(() => {
      if (request !== latest.current) return false;
      setData(null);
      setNotice({ message: "No se pudieron cargar las solicitudes. Inténtalo nuevamente.", isError: true });
      setLoading(false);
      return false;
    });
  }, [loadApplications]);

  useEffect(() => {
    void requestList(query);
  }, [query, requestList]);

  function changeQuery(patch: Partial<ListQuery>) {
    setLoading(true);
    setNotice(null);
    setQuery(current => ({ ...current, ...patch }));
  }

  function retry() {
    setLoading(true);
    setNotice(null);
    void requestList(query);
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    changeQuery({ search: searchDraft.trim(), page: 1 });
  }

  function clearSearch() {
    setSearchDraft("");
    changeQuery({ search: "", page: 1 });
  }

  async function reviewRecord(application: MembershipApplicationListItem, input: { status: MembershipApplicationStatus; reason: string }) {
    setPendingId(application.id);
    setNotice(null);
    try {
      const result = await reviewApplication(application.id, input.status, input.reason || null, application.updatedAt);
      // A saved change and a conflict both need the stored state on screen, so the message waits for the refreshed list.
      if (result.ok || result.code === "conflict") {
        setLoading(true);
        await requestList(query);
      }
      setNotice({ message: result.message, isError: !result.ok });
    } catch {
      setNotice({ message: "No se pudo guardar el seguimiento. Inténtalo nuevamente.", isError: true });
    } finally {
      setPendingId(null);
    }
  }

  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / membershipApplicationPageSize));
  const filtered = query.status !== "all" || query.search !== "";

  return (
    <section className={styles.moduleGrid} aria-label="Solicitudes para ser miembro">
      <article className={`${styles.card} ${styles.cardWide} ${styles.membershipApplicationsCard}`}>
        <div className={styles.applicationArchiveHeading}>
          <div><p className={styles.cardLabel}>Personas que quieren servir</p><h2 className={styles.cardTitle}>Solicitudes de ingreso</h2></div>
          {data ? <span className={styles.storyCount}>{countLabel(data.total)}</span> : null}
        </div>
        <p className={styles.applicationDisclosure}>
          {data?.canManage
            ? "Tu rol puede revisar los datos de contacto, la motivación y las notas internas. Solo la gestión del club ve esta información."
            : "Los datos de contacto y la motivación solo los ve la gestión del club."}
        </p>
        <div className={styles.applicationFilters}>
          <label>Estado
            <select value={query.status} disabled={loading} onChange={event => changeQuery({ status: event.target.value as StatusFilter, page: 1 })}>
              {statusOptions.map(option => <option key={option} value={option}>{statusFilterLabels[option]}</option>)}
            </select>
          </label>
          <form className={styles.applicationSearch} role="search" onSubmit={submitSearch}>
            <label>Buscar
              <input type="search" value={searchDraft} maxLength={membershipApplicationSearchMaxLength} placeholder="Nombre o correo" onChange={event => setSearchDraft(event.target.value)} />
            </label>
            <button type="submit" className={styles.smallButtonQuiet} disabled={loading}>Buscar</button>
            {query.search ? <button type="button" className={styles.smallButtonQuiet} disabled={loading} onClick={clearSearch}>Limpiar</button> : null}
          </form>
        </div>
        {notice ? <p className={notice.isError ? styles.feedbackError : styles.feedbackSuccess} role={notice.isError ? "alert" : "status"}>{notice.message}</p> : null}
        {loading ? <p className={styles.empty} role="status">{data ? "Actualizando solicitudes…" : "Cargando solicitudes…"}</p> : null}
        {!loading && !data ? <button type="button" className={styles.smallButtonQuiet} onClick={retry}>Volver a cargar</button> : null}
        {data ? <>
          {data.applications.map(application => (
            <ApplicationRecord
              key={`${application.id}:${application.updatedAt}`}
              application={application}
              canManage={data.canManage}
              pending={pendingId === application.id}
              disabled={pendingId !== null}
              onReview={input => void reviewRecord(application, input)}
              loadDetail={loadDetail}
              addNote={addNote}
            />
          ))}
          {data.applications.length === 0 && !loading ? <p className={styles.empty}>{filtered ? "No hay solicitudes con estos filtros." : "Todavía no hay solicitudes de ingreso."}</p> : null}
          {data.total > 0 ? <nav className={styles.applicationPagination} aria-label="Paginación de solicitudes">
            <button type="button" className={styles.smallButtonQuiet} disabled={loading || query.page <= 1} onClick={() => changeQuery({ page: query.page - 1 })}>Anterior</button>
            <span>Página {query.page} de {totalPages} · {countLabel(data.total)}</span>
            <button type="button" className={styles.smallButtonQuiet} disabled={loading || query.page >= totalPages} onClick={() => changeQuery({ page: query.page + 1 })}>Siguiente</button>
          </nav> : null}
        </> : null}
      </article>
    </section>
  );
}

// Keyed by updatedAt: after any saved change the record remounts with the stored status and an empty draft.
function ApplicationRecord({ application, canManage, pending, disabled, onReview, loadDetail, addNote }: {
  application: MembershipApplicationListItem;
  canManage: boolean;
  pending: boolean;
  disabled: boolean;
  onReview: (input: { status: MembershipApplicationStatus; reason: string }) => void;
  loadDetail: Props["loadDetail"];
  addNote: Props["addNote"];
}) {
  const [draftStatus, setDraftStatus] = useState<MembershipApplicationStatus>(application.status);
  const [reason, setReason] = useState("");
  const [localError, setLocalError] = useState("");
  const [detailOpened, setDetailOpened] = useState(false);
  const declined = draftStatus === "declined";
  const changed = draftStatus !== application.status || reason.trim().length > 0;

  function submitReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const error = membershipDecisionReasonError(draftStatus, reason);
    if (error) {
      setLocalError(error);
      return;
    }
    setLocalError("");
    onReview({ status: draftStatus, reason: reason.trim() });
  }

  return (
    <article className={styles.applicationRecord}>
      <div className={styles.applicationRecordHeading}>
        <div>
          <span className={styles.applicationStatus}>{membershipApplicationStatusLabels[application.status]}</span>
          <h3>{application.fullName}</h3>
        </div>
        <time dateTime={application.submittedAt}>{formatClubDate(application.submittedAt)}</time>
      </div>
      {canManage || application.occupation ? <dl className={styles.applicationDetails}>
        {application.occupation ? <div><dt>Ocupación</dt><dd>{application.occupation}</dd></div> : null}
        {canManage && application.email ? <div><dt>Correo</dt><dd><a href={`mailto:${application.email}`}>{application.email}</a></dd></div> : null}
        {canManage && application.phone ? <div><dt>Teléfono</dt><dd><a href={`tel:${application.phone.replace(/[^+\d]/g, "")}`}>{application.phone}</a></dd></div> : null}
        {canManage && application.referralSource ? <div><dt>Referida por</dt><dd>{application.referralSource}</dd></div> : null}
        {canManage && application.motivation ? <div className={styles.applicationMotivation}><dt>Motivación</dt><dd>{application.motivation}</dd></div> : null}
        {canManage && application.decisionReason ? <div className={styles.applicationMotivation}><dt>Motivo del último cambio</dt><dd>{application.decisionReason}</dd></div> : null}
      </dl> : null}
      {canManage && (application.accountCreated || application.invitedAt) ? <div className={styles.applicationBadges}>
        {application.accountCreated ? <span className={styles.applicationBadge}>Cuenta creada · apruébala en Miembros y comités</span> : null}
        {application.invitedAt ? <span className={styles.applicationBadge}>Invitada el {formatClubDate(application.invitedAt, false)}</span> : null}
      </div> : null}
      {canManage ? <>
        {localError ? <p className={styles.feedbackError} role="alert">{localError}</p> : null}
        <form className={styles.applicationReview} onSubmit={submitReview}>
          <label>Seguimiento
            <select value={draftStatus} disabled={pending || disabled} onChange={event => { setDraftStatus(event.target.value as MembershipApplicationStatus); setLocalError(""); }}>
              {membershipApplicationStatuses.map(status => <option key={status} value={status}>{membershipApplicationStatusLabels[status]}</option>)}
            </select>
          </label>
          <label className={styles.applicationReasonField}>{declined ? "Motivo del cierre" : "Comentario (opcional)"}
            <textarea
              value={reason}
              onChange={event => { setReason(event.target.value); setLocalError(""); }}
              required={declined}
              minLength={declined ? membershipApplicationReasonRange.min : undefined}
              maxLength={membershipApplicationReasonRange.max}
              disabled={pending || disabled}
            />
          </label>
          <button type="submit" className={styles.smallButton} disabled={pending || disabled || !changed}>
            {pending ? "Guardando…" : "Guardar seguimiento"}
          </button>
        </form>
        <details className={styles.applicationNotesPanel} onToggle={event => { if (event.currentTarget.open) setDetailOpened(true); }}>
          <summary>Notas internas e historial</summary>
          {detailOpened ? <ApplicationNotes applicationId={application.id} loadDetail={loadDetail} addNote={addNote} /> : null}
        </details>
      </> : null}
    </article>
  );
}

// Loaded the first time the panel opens; notes and history are management-only.
function ApplicationNotes({ applicationId, loadDetail, addNote }: { applicationId: string; loadDetail: Props["loadDetail"]; addNote: Props["addNote"] }) {
  const [detail, setDetail] = useState<DetailState | null>(null);
  const [loadError, setLoadError] = useState("");
  const [noteNotice, setNoteNotice] = useState<Notice | null>(null);
  const [saving, setSaving] = useState(false);

  const fetchDetail = useCallback(() => loadDetail(applicationId).then(result => {
    if (result.ok) {
      setDetail({ notes: result.notes ?? [], history: result.history ?? [] });
      setLoadError("");
    } else {
      setLoadError(result.message);
    }
    return result.ok;
  }, () => {
    setLoadError("No se pudo cargar el historial. Inténtalo nuevamente.");
    return false;
  }), [applicationId, loadDetail]);

  useEffect(() => {
    void fetchDetail();
  }, [fetchDetail]);

  async function submitNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const body = String(new FormData(form).get("body") ?? "");
    setSaving(true);
    setNoteNotice(null);
    try {
      const result = await addNote(applicationId, body);
      if (result.ok) {
        form.reset();
        await fetchDetail();
      }
      setNoteNotice({ message: result.message, isError: !result.ok });
    } catch {
      setNoteNotice({ message: "No se pudo guardar la nota. Tu texto sigue en el formulario.", isError: true });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.applicationNotesBody}>
      {loadError ? <p className={styles.feedbackError} role="alert">{loadError}</p> : null}
      {!detail && !loadError ? <p className={styles.empty} role="status">Cargando historial…</p> : null}
      {detail ? <>
        <h4 className={styles.applicationSubheading}>Notas internas</h4>
        {detail.notes.length === 0 ? <p className={styles.empty}>Todavía no hay notas internas.</p> : detail.notes.map(note => (
          <article className={styles.applicationNote} key={note.id}>
            <p><strong>{note.author}</strong> · <time dateTime={note.createdAt}>{formatClubDate(note.createdAt)}</time></p>
            <p className={styles.applicationNoteBody}>{note.body}</p>
          </article>
        ))}
        <form className={styles.applicationNoteForm} onSubmit={submitNote}>
          <label>Nueva nota
            <textarea name="body" required maxLength={membershipApplicationNoteMaxLength} disabled={saving} placeholder="Ej. Llamada realizada; pidió información sobre los comités." />
          </label>
          {noteNotice ? <p className={noteNotice.isError ? styles.feedbackError : styles.feedbackSuccess} role={noteNotice.isError ? "alert" : "status"}>{noteNotice.message}</p> : null}
          <button type="submit" className={styles.smallButtonQuiet} disabled={saving}>{saving ? "Guardando…" : "Añadir nota"}</button>
        </form>
        <h4 className={styles.applicationSubheading}>Historial de seguimiento</h4>
        {detail.history.length === 0 ? <p className={styles.empty}>Todavía no hay cambios registrados.</p> : <ol className={styles.applicationHistory}>
          {detail.history.map(entry => (
            <li key={entry.id}>
              <strong>{entry.fromStatus ? membershipApplicationStatusLabels[entry.fromStatus] : "Inicio"} → {membershipApplicationStatusLabels[entry.toStatus]}</strong>
              <span>{entry.actor} · <time dateTime={entry.createdAt}>{formatClubDate(entry.createdAt)}</time></span>
              {entry.reason ? <span className={styles.applicationHistoryReason}>{entry.reason}</span> : null}
            </li>
          ))}
        </ol>}
      </> : null}
    </div>
  );
}
