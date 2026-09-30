"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import type { FormEvent, ReactNode } from "react";

import type { PlatformSnapshot, ProposalVoteChoice } from "@/lib/platform";
import { defaultAuditFilters, type AuditPageResult } from "@/lib/audit";
import { editorialLayouts, parseEditorialContent } from "@/lib/editorial-content";

import {
  createActivityAction,
  createProposalAction,
  castProposalVoteAction,
  getAuditPageAction,
  getMembershipApplicationsAction,
  markMessageReadAction,
  markNotificationReadAction,
  sendInternalMessageAction,
  setStoryPublicationAction,
  setProposalVotingAction,
  submitProposalAction,
  updateMembershipAction,
  updateMembershipApplicationStatusAction,
  updateTaskStatusAction,
  type PlatformActionResult,
} from "./actions";
import { CommitteeManager } from "./CommitteeManager";
import { FinanceModule } from "./FinanceModule";
import { MembershipApplicationsModule } from "./MembershipApplicationsModule";
import { ProposalCard } from "./ProposalCard";
import { SignOutButton } from "./SignOutButton";
import { PlatformEvents } from "./PlatformEvents";
import { PlatformAudit } from "./PlatformAudit";
import { StoryComposerDialog } from "./StoryComposerDialog";
import { MembershipPhotoManager } from "./MembershipPhotoManager";
import styles from "./platform.module.css";

type Tab = "resumen" | "propuestas" | "agenda" | "finanzas" | "solicitudes" | "organizacion" | "revista" | "fotografias" | "mensajes" | "auditoria";

const tabs: Array<{ id: Tab; label: string }> = [
  { id: "resumen", label: "Resumen" },
  { id: "propuestas", label: "Propuestas" },
  { id: "agenda", label: "Agenda" },
  { id: "finanzas", label: "Finanzas" },
  { id: "solicitudes", label: "Solicitudes" },
  { id: "organizacion", label: "Organización" },
  { id: "revista", label: "Revista" },
  { id: "fotografias", label: "Fotografías" },
  { id: "mensajes", label: "Mensajes" },
  { id: "auditoria", label: "Auditoría" },
];

const roleLabels: Record<string, string> = {
  member: "Miembro",
  coordinator: "Coordinación",
  editor: "Edición",
  club_manager: "Gestión del club",
  admin: "Administración",
};

const statusLabels: Record<string, string> = {
  published: "Publicada",
  draft: "Borrador",
  submitted: "Enviada",
  in_review: "En revisión",
  approved: "Aprobada",
  rejected: "Devuelta",
  archived: "Archivada",
  planned: "Planificada",
  active: "Activa",
  completed: "Completada",
  cancelled: "Cancelada",
  todo: "Pendiente",
  in_progress: "En curso",
  blocked: "Bloqueada",
  done: "Completada",
};

function formatDate(value: string | null | undefined, withTime = false) {
  if (!value) return "Fecha por confirmar";
  return new Intl.DateTimeFormat("es-DO", {
    dateStyle: "medium",
    ...(withTime ? { timeStyle: "short" as const } : {}),
    timeZone: "America/Santo_Domingo",
  }).format(new Date(value));
}

function ActionFeedback({ message, error }: { message: string; error: boolean }) {
  if (!message) return null;
  return <p className={error ? styles.feedbackError : styles.feedbackSuccess} role={error ? "alert" : "status"}>{message}</p>;
}

function EmptyState({ children }: { children: ReactNode }) {
  return <p className={styles.empty}>{children}</p>;
}

function NotificationBell({ notifications, disabled, onMarkRead, onViewAll, messagingSchema }: {
  notifications: PlatformSnapshot["notifications"];
  disabled: boolean;
  onMarkRead: (id: string) => void;
  onViewAll: () => void;
  messagingSchema: PlatformSnapshot["messagingSchema"];
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const unreadCount = notifications.filter(notification => !notification.readAt).length;
  const recentNotifications = notifications.slice(0, 6);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    }
    function handleEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  function viewAll() {
    setOpen(false);
    onViewAll();
    buttonRef.current?.focus();
  }

  return <div ref={rootRef} className={styles.notificationAnchor}>
    <button ref={buttonRef} type="button" className={styles.notificationButton} disabled={disabled}
      aria-expanded={open} aria-controls="platform-notification-panel"
      aria-label={unreadCount > 0 ? "Notificaciones, " + unreadCount + " sin leer" : "Notificaciones"}
      onClick={() => setOpen(value => !value)}>
      <svg viewBox="0 0 24 24" width="17" height="17" fill="none" aria-hidden="true">
        <path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span>Notificaciones</span>
      {unreadCount > 0 ? <span className={styles.notificationBadge} aria-live="polite" aria-atomic="true">{unreadCount > 99 ? "99+" : unreadCount}</span> : null}
    </button>
    <section id="platform-notification-panel" className={styles.notificationPanel} hidden={!open}
      aria-label="Notificaciones recientes">
      <header className={styles.notificationPanelHeader}>
        <h2>Notificaciones</h2>
        <span>{unreadCount === 1 ? "1 sin leer" : unreadCount + " sin leer"}</span>
      </header>
      {recentNotifications.length > 0 ? <ul className={styles.notificationList}>
        {recentNotifications.map(notification => <li className={styles.notificationItem}
          data-unread={notification.readAt ? "false" : "true"} key={notification.id}>
          <strong>{notification.title}</strong>
          <time dateTime={notification.createdAt}>{formatDate(notification.createdAt, true)}</time>
          <p>{notification.body}</p>
          {!notification.readAt ? <button type="button" className={styles.notificationReadButton}
            disabled={disabled} onClick={() => onMarkRead(notification.id)}>Marcar como leído</button> : null}
        </li>)}
      </ul> : <p className={styles.notificationEmpty}>
        {messagingSchema.state === "ready" ? "No tienes notificaciones todavía."
          : messagingSchema.message ?? "Las notificaciones no están disponibles ahora."}
      </p>}
      <button type="button" className={styles.notificationAllButton} disabled={disabled} onClick={viewAll}>
        Ver todos los avisos →
      </button>
    </section>
  </div>;
}

export function PlatformWorkspace({ snapshot }: { snapshot: PlatformSnapshot }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("resumen");
  const [feedback, setFeedback] = useState("");
  const [feedbackError, setFeedbackError] = useState(false);
  const [pending, startTransition] = useTransition();
  const [auditResult, setAuditResult] = useState<AuditPageResult | null>(null);
  const auditRequest = useRef(0);
  const user = snapshot.user;

  function selectTab(next: Tab) {
    if (next === tab) return;
    setTab(next);
    setFeedback("");
    if (next === "auditoria" && snapshot.capabilities.canAudit) {
      const request = ++auditRequest.current;
      setAuditResult(null);
      startTransition(async () => {
        try {
          const result = await getAuditPageAction(defaultAuditFilters);
          if (request === auditRequest.current) setAuditResult(result);
        } catch {
          if (request === auditRequest.current) setAuditResult({ ok: false, message: "No se pudo consultar la auditoría. Inténtalo de nuevo." });
        }
      });
    }
  }

  function run(action: Promise<PlatformActionResult>) {
    startTransition(async () => {
      const result = await action;
      setFeedback(result.message);
      setFeedbackError(!result.ok);
      if (result.ok) router.refresh();
    });
  }

  function handleProposal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    run(createProposalAction({
      title: String(data.get("title") ?? ""),
      summary: String(data.get("summary") ?? ""),
      details: String(data.get("details") ?? ""),
    }));
    event.currentTarget.reset();
  }

  function handleActivity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    run(createActivityAction({
      title: String(data.get("title") ?? ""),
      description: String(data.get("description") ?? ""),
      startsAt: String(data.get("startsAt") ?? ""),
      endsAt: String(data.get("endsAt") ?? ""),
      location: String(data.get("location") ?? ""),
    }));
    event.currentTarget.reset();
  }

  function handleMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    run(sendInternalMessageAction({
      recipientUserId: String(data.get("recipientUserId") ?? ""),
      subject: String(data.get("subject") ?? ""),
      body: String(data.get("body") ?? ""),
    }));
    event.currentTarget.reset();
  }

  if (snapshot.access !== "active") {
    return <main className={styles.shell}><div className={styles.inner}>
      <header className={styles.header}>
        <div><p className={styles.eyebrow}>Plataforma del club</p><h1 className={styles.title}>Hola, <em>{user?.displayName.split(" ")[0] ?? "amigo"}.</em></h1></div>
        <div><p className={styles.identity}><strong>{user?.displayName ?? "Cuenta del club"}</strong><span className={styles.role}>{snapshot.access === "suspended" ? "Acceso suspendido" : "Solicitud pendiente"}</span></p><SignOutButton /></div>
      </header>
      <section className={styles.content}><div className={styles.notice}>
        <p className={styles.cardLabel}>Estado de la cuenta</p>
        <h2>{snapshot.access === "suspended" ? "Tu membresía está suspendida." : "Tu solicitud está en revisión."}</h2>
        <p>{snapshot.accessMessage}</p>
        <p className={styles.noticeMessage}>La plataforma se abrirá cuando el club confirme tu membresía. Mientras tanto, puedes volver a conocer su historia y sus próximas publicaciones.</p>
        <Link className={styles.button} href="/nosotros">Conocer el club →</Link>
      </div></section>
      <Link className={styles.back} href="/">← Volver al sitio público</Link>
    </div></main>;
  }

  const unreadNotifications = snapshot.notifications.filter((item) => !item.readAt).length;
  const unreadMessages = snapshot.messages.filter((item) => item.direction === "inbox" && !item.readAt).length;

  return <main className={styles.shell}><div className={styles.inner}>
    <header className={styles.header}>
      <div><p className={styles.eyebrow}>Plataforma del club · espacio interno</p><h1 className={styles.title}>Hola, <em>{user?.displayName.split(" ")[0] ?? "miembro"}.</em></h1></div>
      <div className={styles.accountHeader}>
        <p className={styles.identity}><strong>{user?.displayName}</strong><span className={styles.role}>{roleLabels[snapshot.membership?.role ?? "member"]}</span><span>Membresía activa</span></p>
        <div className={styles.headerActions}>
          <NotificationBell notifications={snapshot.notifications} messagingSchema={snapshot.messagingSchema} disabled={pending}
            onMarkRead={id => run(markNotificationReadAction(id))}
            onViewAll={() => selectTab("mensajes")} />
          <SignOutButton />
        </div>
      </div>
    </header>

    <section className={styles.content}>
      <div className={styles.workspaceIntro}><div><p className={styles.cardLabel}>Centro de coordinación</p><h2>Ideas, personas y servicio en un mismo lugar.</h2></div><p>{snapshot.accessMessage} Los módulos se muestran según tu rol y tus permisos.</p></div>
      <nav className={styles.tabs} aria-label="Módulos de la plataforma">
        {tabs.filter(item =>
          (item.id !== "auditoria" || snapshot.capabilities.canAudit) &&
          (item.id !== "fotografias" || snapshot.capabilities.canEdit)
        ).map((item) => <button type="button" key={item.id} className={tab === item.id ? styles.tabActive : styles.tab} onClick={() => selectTab(item.id)}>{item.label}{item.id === "mensajes" && (unreadNotifications + unreadMessages > 0) ? <span className={styles.tabBadge}>{unreadNotifications + unreadMessages}</span> : null}</button>)}
      </nav>
      <ActionFeedback message={feedback} error={feedbackError} />

      {tab === "auditoria" && snapshot.capabilities.canAudit && <PlatformAudit initialResult={auditResult} initialLoading={pending && !auditResult} />}

      {tab === "resumen" && <section className={styles.moduleGrid}>
        <PlatformEvents snapshot={snapshot} summary onOpenAgenda={() => setTab("agenda")} />
        <article className={styles.card}><p className={styles.cardLabel}>Tu pulso</p><div className={styles.metric}><strong>{snapshot.proposals.length}</strong><span>propuestas visibles</span></div><div className={styles.metric}><strong>{snapshot.tasks.filter(task => task.status !== "done").length}</strong><span>tareas abiertas</span></div></article>
        <article className={styles.card}><p className={styles.cardLabel}>Avisos</p><h2 className={styles.cardTitle}>{unreadNotifications || "Sin"} {unreadNotifications === 1 ? "aviso nuevo" : "avisos nuevos"}.</h2><p className={styles.empty}>Revisa Mensajes para leer las novedades del club.</p></article>
        <article className={`${styles.card} ${styles.cardWide}`}><p className={styles.cardLabel}>Actividad reciente</p><h2 className={styles.cardTitle}>Lo que se está moviendo.</h2>{snapshot.activities.slice(0, 4).map(activity => <div className={styles.row} key={activity.id}><div><strong>{activity.title}</strong><small>{statusLabels[activity.status] ?? activity.status} · {activity.location ?? "Ubicación por confirmar"}</small></div></div>)}{snapshot.activities.length === 0 && <EmptyState>Las actividades aparecerán cuando coordinación las registre.</EmptyState>}</article>
        <article className={`${styles.card} ${styles.cardWide}`}><p className={styles.cardLabel}>Tareas abiertas</p><h2 className={styles.cardTitle}>Cada compromiso tiene un siguiente paso.</h2>{snapshot.tasks.slice(0, 5).map(task => <div className={styles.row} key={task.id}><div><strong>{task.title}</strong><small>{statusLabels[task.status] ?? task.status} · {task.dueAt ? `Vence ${formatDate(task.dueAt)}` : "Sin fecha límite"}</small></div><button type="button" className={styles.smallButtonQuiet} disabled={pending || task.status === "done"} onClick={() => run(updateTaskStatusAction(task.id, task.status === "in_progress" ? "done" : "in_progress"))}>{task.status === "in_progress" ? "Marcar lista" : "Empezar"}</button></div>)}{snapshot.tasks.length === 0 && <EmptyState>Las tareas de propuestas y actividades aparecerán aquí.</EmptyState>}</article>
      </section>}

      {tab === "propuestas" && <section className={styles.moduleGrid}>
        <article className={`${styles.card} ${styles.cardWide}`}>
          <p className={styles.cardLabel}>Ideas del club</p><h2 className={styles.cardTitle}>Del deseo al plan.</h2>
          {snapshot.proposalVotingSchema.state !== "ready" && snapshot.proposalVotingSchema.message
            ? <p className={styles.proposalModuleNotice} role="status">{snapshot.proposalVotingSchema.message}</p>
            : null}
          {snapshot.proposals.map(proposal => <ProposalCard key={proposal.id} proposal={proposal}
            metadata={`${statusLabels[proposal.status] ?? proposal.status} · ${formatDate(proposal.createdAt)} · Autor: ${proposal.authorName}`}
            currentUserId={user?.id ?? ""}
            canManageVoting={snapshot.proposalVotingSchema.state === "ready" && (snapshot.capabilities.canCoordinate || snapshot.capabilities.canManageClub)}
            pending={pending}
            onSubmit={() => run(submitProposalAction(proposal.id))}
            onToggleVoting={enabled => run(setProposalVotingAction(proposal.id, enabled))}
            onVote={(choice: ProposalVoteChoice) => run(castProposalVoteAction(proposal.id, choice))} />)}
          {snapshot.proposals.length === 0 && <EmptyState>Todavía no hay propuestas visibles. Puedes abrir la primera conversación en el formulario.</EmptyState>}
        </article>
        <form className={styles.formCard} onSubmit={handleProposal}>
          <p className={styles.cardLabel}>Nueva propuesta</p><h2 className={styles.cardTitle}>Una idea concreta.</h2>
          <p className={styles.empty}>Se guardará tu membresía como autor: {user?.displayName ?? "Miembro del club"}.</p>
          <label>Título<input name="title" required minLength={3} maxLength={180} placeholder="Ej. Recuperar una plaza" /></label>
          <label>Resumen<textarea name="summary" required minLength={10} maxLength={1200} placeholder="¿Qué necesidad atiende y por qué ahora?" /></label>
          <label>Detalles<textarea name="details" maxLength={4000} placeholder="Aliados, pasos iniciales, recursos…" /></label>
          <button className={styles.button} disabled={pending}>{pending ? "Guardando…" : "Guardar borrador"}</button>
        </form>
      </section>}

      {tab === "agenda" && <section className={styles.moduleGrid}>
        <PlatformEvents snapshot={snapshot} />
        {snapshot.capabilities.canCoordinate ? <form className={styles.formCard} onSubmit={handleActivity}><p className={styles.cardLabel}>Nueva actividad</p><h2 className={styles.cardTitle}>Convierte el plan en movimiento.</h2><label>Nombre<input name="title" required minLength={3} maxLength={180} /></label><label>Inicio<input name="startsAt" type="datetime-local" /></label><label>Fin<input name="endsAt" type="datetime-local" /></label><label>Lugar<input name="location" maxLength={300} /></label><label>Descripción<textarea name="description" maxLength={4000} /></label><button className={styles.button} disabled={pending}>{pending ? "Guardando…" : "Guardar actividad"}</button></form> : <article className={styles.card}><p className={styles.cardLabel}>Coordina con tu equipo</p><h2 className={styles.cardTitle}>La agenda se construye entre todos.</h2><EmptyState>Cuando tengas una fecha o una idea, compártela en Propuestas.</EmptyState></article>}
      </section>}

      {tab === "finanzas" && <FinanceModule canManage={snapshot.capabilities.canManageFinances} />}

      {tab === "fotografias" && snapshot.capabilities.canEdit && <MembershipPhotoManager />}

      {tab === "solicitudes" && <MembershipApplicationsModule
        canReview={snapshot.capabilities.canManageMembership}
        loadApplications={getMembershipApplicationsAction}
        updateStatus={updateMembershipApplicationStatusAction}
      />}

      {tab === "organizacion" && <section className={styles.moduleGrid}>
        <CommitteeManager committees={snapshot.committees} candidates={snapshot.committeeCandidates}
          canManage={snapshot.capabilities.canManageCommittees} />
        {snapshot.capabilities.canManageMembership ? <article className={`${styles.card} ${styles.cardWide}`}><p className={styles.cardLabel}>Solicitudes de membresía</p><h2 className={styles.cardTitle}>Personas que quieren servir.</h2>{snapshot.pendingMembers.map(member => <div className={styles.row} key={member.userId}><div><strong>{member.name}</strong><small>Solicitud recibida · {formatDate(member.createdAt)}</small></div><div className={styles.rowActions}><button type="button" className={styles.smallButton} disabled={pending} onClick={() => run(updateMembershipAction({ userId: member.userId, status: "active", role: "member" }))}>Activar</button><button type="button" className={styles.smallButtonQuiet} disabled={pending} onClick={() => run(updateMembershipAction({ userId: member.userId, status: "suspended", role: member.role }))}>Rechazar</button></div></div>)}{snapshot.pendingMembers.length === 0 && <EmptyState>No hay solicitudes pendientes.</EmptyState>}</article> : null}
      </section>}

      {tab === "revista" && <section className={styles.moduleGrid}>
        <article className={`${styles.card} ${styles.cardWide} ${styles.storyArchiveCard}`}>
          <div className={styles.storyArchiveHeading}><div><p className={styles.cardLabel}>Archivo editorial</p><h2 className={styles.cardTitle}>Publicaciones del club</h2></div><span className={styles.storyCount}>{snapshot.stories.length} {snapshot.stories.length === 1 ? "historia" : "historias"}</span></div>
          {snapshot.stories.map(story => {
            const editorial = parseEditorialContent(story.content);
            const layoutName = editorialLayouts.find(layout => layout.id === editorial?.layoutId)?.name ?? "Formato anterior";
            return <article className={styles.storyAdminRow} key={story.id}>
              <div className={styles.storyAdminMeta}><span className={story.isPublic ? styles.storyPublished : styles.storyDraft}>{story.isPublic ? "Publicada" : statusLabels[story.status] ?? story.status}</span><span>{layoutName}</span><time>{story.publishedAt ? formatDate(story.publishedAt) : "Aún no publicada"}</time></div>
              <h3>{story.isPublic ? <Link href={`/revista/${story.slug}`}>{story.title}</Link> : story.title}</h3>
              <p>{story.excerpt ?? "Sin bajada todavía."}</p>
              <div className={styles.storyAdminActions}>
                {story.isPublic ? <Link href={`/revista/${story.slug}`} className={styles.storyTextLink}>Ver publicación ↗</Link> : <span className={styles.storyPrivateNote}>Solo equipo editorial</span>}
                {snapshot.capabilities.canEdit ? <button type="button" className={styles.smallButtonQuiet} disabled={pending} onClick={() => run(setStoryPublicationAction(story.id, !story.isPublic))}>{story.isPublic ? "Pasar a borrador" : "Publicar"}</button> : null}
              </div>
            </article>;
          })}
          {snapshot.stories.length === 0 ? <div className={styles.storyArchiveEmpty}><span>01 / ARCHIVO ABIERTO</span><h3>Aquí aparecerán las historias del club.</h3><p>La base de datos todavía no contiene publicaciones propias. Las lecturas de ejemplo en Revista son maquetas editoriales, no posts publicados.</p></div> : null}
        </article>
        {snapshot.capabilities.canEdit
          ? <StoryComposerDialog canPublish={snapshot.capabilities.canEdit} />
          : <article className={styles.card}><p className={styles.cardLabel}>Equipo editorial</p><h2 className={styles.cardTitle}>Una historia bien contada también sirve.</h2><EmptyState>El rol de edición puede preparar y publicar historias verificadas del club.</EmptyState></article>}
      </section>}

      {tab === "mensajes" && <section className={styles.moduleGrid}>
        <article className={`${styles.card} ${styles.cardWide}`}><p className={styles.cardLabel}>Avisos y conversaciones</p><h2 className={styles.cardTitle}>Lo importante, cerca.</h2>{snapshot.notifications.slice(0, 8).map(notification => <div className={styles.row} key={notification.id}><div><strong>{notification.title}</strong><small>{formatDate(notification.createdAt, true)} · {notification.readAt ? "Leído" : "Sin leer"}</small><span>{notification.body}</span></div>{!notification.readAt ? <button type="button" className={styles.smallButtonQuiet} disabled={pending} onClick={() => run(markNotificationReadAction(notification.id))}>Marcar leído</button> : null}</div>)}{snapshot.notifications.length === 0 && <EmptyState>No hay avisos nuevos.</EmptyState>}{snapshot.messages.slice(0, 8).map(message => <div className={styles.message} key={`${message.direction}-${message.id}`}><div><span className={styles.messageTag}>{message.direction === "inbox" ? "Recibido" : "Enviado"}</span><strong>{message.subject}</strong><small>{message.senderName} · {formatDate(message.createdAt, true)}</small></div><p>{message.body}</p>{message.direction === "inbox" && !message.readAt ? <button type="button" className={styles.smallButtonQuiet} disabled={pending} onClick={() => run(markMessageReadAction(message.id))}>Marcar leído</button> : null}</div>)}{snapshot.messages.length === 0 && snapshot.messagingSchema.state === "ready" && <EmptyState>Tu buzón todavía está vacío.</EmptyState>}{snapshot.messagingSchema.state !== "ready" && <p className={styles.noticeMessage}>{snapshot.messagingSchema.message}</p>}</article>
        <form className={styles.formCard} onSubmit={handleMessage}><p className={styles.cardLabel}>Nuevo mensaje</p><h2 className={styles.cardTitle}>Mantén el vínculo.</h2><label>Destinatario<select name="recipientUserId" defaultValue=""><option value="" disabled>Selecciona una persona</option>{snapshot.capabilities.canBroadcast && <option value="all">Aviso a todo el club</option>}{snapshot.memberDirectory.filter(member => member.userId !== user?.id).map(member => <option key={member.userId} value={member.userId}>{member.name}</option>)}</select></label><label>Asunto<input name="subject" required minLength={3} maxLength={180} /></label><label>Mensaje<textarea name="body" required minLength={1} maxLength={8000} /></label><button className={styles.button} disabled={pending || snapshot.messagingSchema.state !== "ready"}>{pending ? "Enviando…" : "Enviar mensaje"}</button></form>
      </section>}

      {(snapshot.dataWarnings.length > 0) && <details className={styles.warnings}><summary>Algunas fuentes no respondieron</summary><ul>{snapshot.dataWarnings.map(warning => <li key={warning}>{warning}</li>)}</ul></details>}
    </section>
    <Link className={styles.back} href="/">← Volver al sitio público</Link>
  </div></main>;
}
