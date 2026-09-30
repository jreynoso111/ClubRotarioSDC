"use client";

import { useEffect, useState } from "react";

import {
  membershipApplicationStatuses,
  membershipApplicationStatusLabels,
  type MembershipApplication,
  type MembershipApplicationStatus,
} from "@/lib/membership-applications";

import type { MembershipApplicationsActionResult, PlatformActionResult } from "./actions";
import styles from "./platform.module.css";

type Props = {
  canReview: boolean;
  loadApplications: () => Promise<MembershipApplicationsActionResult>;
  updateStatus: (applicationId: string, status: MembershipApplicationStatus) => Promise<PlatformActionResult>;
};

function formatSubmittedAt(value: string) {
  return new Intl.DateTimeFormat("es-DO", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "America/Santo_Domingo",
  }).format(new Date(value));
}

export function MembershipApplicationsModule({ canReview, loadApplications, updateStatus }: Props) {
  const [applications, setApplications] = useState<MembershipApplication[]>([]);
  const [draftStatuses, setDraftStatuses] = useState<Record<string, MembershipApplicationStatus>>({});
  const [loading, setLoading] = useState(true);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);

  async function refresh() {
    setLoading(true);
    try {
      const result = await loadApplications();
      if (!result.ok) {
        setMessage(result.message);
        setIsError(true);
        return;
      }
      setApplications(result.applications);
      setDraftStatuses(Object.fromEntries(result.applications.map(application => [application.id, application.status])));
      setMessage("");
      setIsError(false);
    } catch {
      setMessage("No se pudieron cargar las solicitudes. Inténtalo nuevamente.");
      setIsError(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let mounted = true;
    void loadApplications().then(result => {
      if (!mounted) return;
      if (!result.ok) {
        setMessage(result.message);
        setIsError(true);
      } else {
        setApplications(result.applications);
        setDraftStatuses(Object.fromEntries(result.applications.map(application => [application.id, application.status])));
      }
      setLoading(false);
    }).catch(() => {
      if (!mounted) return;
      setMessage("No se pudieron cargar las solicitudes. Inténtalo nuevamente.");
      setIsError(true);
      setLoading(false);
    });
    return () => { mounted = false; };
  }, [loadApplications]);

  async function saveStatus(application: MembershipApplication) {
    const status = draftStatuses[application.id];
    if (!canReview || !status || status === application.status) return;
    setPendingId(application.id);
    setMessage("");
    try {
      const result = await updateStatus(application.id, status);
      setMessage(result.message);
      setIsError(!result.ok);
      if (result.ok) await refresh();
    } catch {
      setMessage("No se pudo guardar el seguimiento. Inténtalo nuevamente.");
      setIsError(true);
    } finally {
      setPendingId(null);
    }
  }

  return (
    <section className={styles.moduleGrid} aria-label="Solicitudes para ser miembro">
      <article className={`${styles.card} ${styles.cardWide} ${styles.membershipApplicationsCard}`}>
        <div className={styles.applicationArchiveHeading}>
          <div><p className={styles.cardLabel}>Personas que quieren servir</p><h2 className={styles.cardTitle}>Solicitudes de ingreso</h2></div>
          <span className={styles.storyCount}>{applications.length} {applications.length === 1 ? "solicitud" : "solicitudes"}</span>
        </div>
        <p className={styles.applicationDisclosure}>Disponible para miembros activos. Las personas que enviaron el formulario autorizaron compartir estos datos de contacto con el club.</p>
        {message ? <p className={isError ? styles.feedbackError : styles.feedbackSuccess} role={isError ? "alert" : "status"}>{message}</p> : null}
        {loading ? <p className={styles.empty} role="status">Cargando solicitudes…</p> : null}
        {!loading && applications.map(application => (
          <article className={styles.applicationRecord} key={application.id}>
            <div className={styles.applicationRecordHeading}>
              <div><span className={styles.applicationStatus}>{membershipApplicationStatusLabels[application.status]}</span><h3>{application.full_name}</h3></div>
              <time dateTime={application.submitted_at}>{formatSubmittedAt(application.submitted_at)}</time>
            </div>
            <dl className={styles.applicationDetails}>
              <div><dt>Correo</dt><dd><a href={`mailto:${application.email}`}>{application.email}</a></dd></div>
              <div><dt>Teléfono</dt><dd><a href={`tel:${application.phone.replace(/[^+\d]/g, "")}`}>{application.phone}</a></dd></div>
              {application.occupation ? <div><dt>Ocupación</dt><dd>{application.occupation}</dd></div> : null}
              {application.referral_source ? <div><dt>Referida por</dt><dd>{application.referral_source}</dd></div> : null}
              <div className={styles.applicationMotivation}><dt>Motivación</dt><dd>{application.motivation}</dd></div>
            </dl>
            {canReview ? <div className={styles.applicationReview}>
              <label htmlFor={`application-status-${application.id}`}>Seguimiento
                <select
                  id={`application-status-${application.id}`}
                  value={draftStatuses[application.id] ?? application.status}
                  onChange={event => setDraftStatuses(current => ({ ...current, [application.id]: event.target.value as MembershipApplicationStatus }))}
                  disabled={pendingId === application.id}
                >
                  {membershipApplicationStatuses.map(status => <option key={status} value={status}>{membershipApplicationStatusLabels[status]}</option>)}
                </select>
              </label>
              <button type="button" className={styles.smallButton} disabled={pendingId === application.id || draftStatuses[application.id] === application.status} onClick={() => void saveStatus(application)}>
                {pendingId === application.id ? "Guardando…" : "Guardar seguimiento"}
              </button>
            </div> : null}
          </article>
        ))}
        {!loading && !isError && applications.length === 0 ? <p className={styles.empty}>Todavía no hay solicitudes de ingreso.</p> : null}
        {isError && !loading ? <button type="button" className={styles.smallButtonQuiet} onClick={() => void refresh()}>Volver a cargar</button> : null}
      </article>
    </section>
  );
}
