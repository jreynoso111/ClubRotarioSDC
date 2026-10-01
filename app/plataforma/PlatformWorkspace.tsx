"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import type { FormEvent, ReactNode } from "react";

import type { PlatformSnapshot, ProposalVoteChoice } from "@/lib/platform";
import { defaultAuditFilters, type AuditPageResult } from "@/lib/audit";
import { editorialLayouts, parseEditorialContent } from "@/lib/editorial-content";

import {
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
  updateMembershipApplicationStatusAction,
  updateTaskStatusAction,
  type PlatformActionResult,
} from "./actions";
import { editProposalDraftAction, reviewProposalAction } from "./proposal-management-actions";
import { OrganizationManager } from "./OrganizationManager";
import { ActivityManager } from "./ActivityManager";
import { FinanceModule } from "./FinanceModule";
import { MembershipApplicationsModule } from "./MembershipApplicationsModule";
import { ProposalCard } from "./ProposalCard";
import { SignOutButton } from "./SignOutButton";
import { PlatformEvents } from "./PlatformEvents";
import { PlatformAudit } from "./PlatformAudit";
import { StoryComposerDialog } from "./StoryComposerDialog";
import { MembershipPhotoManager } from "./MembershipPhotoManager";
import styles from "./platform.module.css";

type Tab = "resumen" | "propuestas" | "agenda" | "actividades" | "finanzas" | "solicitudes" | "organizacion" | "revista" | "fotografias" | "mensajes" | "auditoria";

const tabs: Array<{ id: Tab; label: string }> = [
  { id: "resumen", label: "Resumen" },
  { id: "propuestas", label: "Propuestas" },
  { id: "agenda", label: "Agenda" },
  { id: "actividades", label: "Actividades y tareas" },
  { id: "finanzas", label: "Finanzas" },
  { id: "solicitudes", label: "Solicitudes" },
  { id: "organizacion", label: "Miembros y comités" },
  { id: "revista", label: "Revista" },
  { id: "fotografias", label: "Fotos de la web" },
  { id: "mensajes", label: "Mensajes" },
  { id: "auditoria", label: "Auditoría" },
];

const administrationTabs: Tab[] = ["revista", "fotografias", "auditoria"];

function ModuleIcon({ module }: { module: Tab }) {
  const paths: Record<Tab, string> = {
    resumen: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
    propuestas: "M9 18h6 M10 21h4 M8 14a6 6 0 1 1 8 0l-1 2H9z",
    agenda: "M4 5h16v16H4z M8 3v4 M16 3v4 M4 10h16 M8 14h2 M14 14h2",
    actividades: "M4 3h16v18H4z M8 7h8 M8 12h8 M8 17h5",
    finanzas: "M3 7h18v14H3z M3 7V4h15 M15 12h6v5h-6z",
    solicitudes: "M5 3h10l4 4v14H5z M9 11h6 M9 15h6 M15 3v5h4",
    organizacion: "M8 21v-4h8v4 M12 13v4 M4 17v-4h16v4 M9 3h6v6H9z",
    revista: "M3 4h7l2 2 2-2h7v16h-7l-2 1-2-1H3z M12 6v15",
    fotografias: "M3 6h5l2-3h4l2 3h5v15H3z M15 13a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
    mensajes: "M3 4h18v14H9l-6 3z M7 9h10 M7 13h6",
    auditoria: "M12 3l8 3v6c0 5-8 9-8 9s-8-4-8-9V6z M8 12l3 3 5-6",
  };
  return <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[module]} /></svg>;
}

const descriptions: Record<Tab, string> = {
  resumen: "Consulta los próximos encuentros y los compromisos abiertos.",
  propuestas: "Presenta ideas, revisa sus detalles y da seguimiento a la votación y decisión.",
  agenda: "Gestiona eventos, su publicación en la web y la asistencia de miembros.",
  actividades: "Coordina el trabajo del club con responsables, fechas y tareas.",
  finanzas: "Consulta los ingresos, egresos y aportes de cada miembro o actividad.",
  solicitudes: "Da seguimiento a las personas que solicitan ingresar desde la web.",
  organizacion: "Define la directiva rotaria, asigna cargos a los perfiles y organiza los comités del club.",
  revista: "Prepara, edita y publica artículos con sus fotografías y diseño.",
  fotografias: "Identifica la ubicación de cada imagen y edita las fotos de la página de ingreso.",
  mensajes: "Consulta tus avisos y conversaciones con los miembros del club.",
  auditoria: "Revisa quién cambió cada registro y compara sus valores anteriores y actuales.",
};

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
  const [administrationExpanded, setAdministrationExpanded] = useState(false);
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

  function run(action: Promise<PlatformActionResult>, onSuccess?: () => void) {
    startTransition(async () => {
      try {
        const result = await action;
        setFeedback(result.message);
        setFeedbackError(!result.ok);
        if (result.ok) { onSuccess?.(); router.refresh(); }
      } catch {
        setFeedback("No se pudo guardar. Tus datos siguen en el formulario para volver a intentarlo.");
        setFeedbackError(true);
      }
    });
  }

  function handleProposal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    run(createProposalAction({
      title: String(data.get("title") ?? ""),
      summary: String(data.get("summary") ?? ""),
      details: String(data.get("details") ?? ""),
    }), () => form.reset());
  }

  function handleMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    run(sendInternalMessageAction({
      recipientUserId: String(data.get("recipientUserId") ?? ""),
      subject: String(data.get("subject") ?? ""),
      body: String(data.get("body") ?? ""),
    }), () => form.reset());
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
  const isAdministrator = snapshot.membership?.role === "admin";
  const availableTabs = tabs.filter(item =>
    (item.id !== "auditoria" || snapshot.capabilities.canAudit) &&
    (item.id !== "fotografias" || snapshot.capabilities.canEdit)
  );
  const mainTabs = availableTabs.filter(item => !isAdministrator || !administrationTabs.includes(item.id));
  const adminTabs = isAdministrator ? availableTabs.filter(item => administrationTabs.includes(item.id)) : [];

  return <main className={`${styles.shell} ${styles.dashboard} ${isAdministrator ? styles.dashboardWithAdmin : ""}`}>
    <aside className={styles.sidebar}>
      <Link href="/" className={styles.clubBrand}><Image src="/club-santo-domingo-colonial-logo.png" alt="Rotary Club Santo Domingo Colonial" width={1401} height={310} preload /></Link>
      <div className={styles.sideSection}>ESPACIO DE TRABAJO</div>
      <nav className={styles.sideNav} aria-label="Módulos de la plataforma">
        {mainTabs.map((item) => <button type="button" key={item.id} className={tab === item.id ? styles.tabActive : styles.tab} aria-current={tab === item.id ? "page" : undefined} onClick={() => selectTab(item.id)}><ModuleIcon module={item.id} /><span>{item.label}</span>{item.id === "mensajes" && (unreadNotifications + unreadMessages > 0) ? <span className={styles.tabBadge}>{unreadNotifications + unreadMessages}</span> : null}</button>)}
      </nav>
      <div className={styles.sidebarFooter}><span className={styles.memberDot} /> Membresía activa<p>Personas de acción.<br />Un club, muchas formas de servir.</p><Link href="/">Visitar sitio público ↗</Link></div>
    </aside>
    {isAdministrator && <aside className={`${styles.adminRail} ${administrationExpanded ? styles.adminRailExpanded : ""}`} aria-label="Herramientas de administración">
      <button type="button" className={styles.adminToggle} aria-expanded={administrationExpanded} aria-controls="administration-navigation"
        aria-label={administrationExpanded ? "Contraer administración" : "Expandir administración"}
        title={administrationExpanded ? "Contraer administración" : "Expandir administración"}
        onClick={() => setAdministrationExpanded(expanded => !expanded)}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 4h18v16H3z M16 4v16" /><path d={administrationExpanded ? "M8 9l3 3-3 3" : "M11 9l-3 3 3 3"} /></svg>
        <span className={styles.adminLabel}>Administración</span>
      </button>
      <nav id="administration-navigation" className={styles.adminNav} aria-label="Administración">
        {adminTabs.map(item => <button type="button" key={item.id}
          className={`${styles.adminTab} ${tab === item.id ? styles.adminTabActive : ""}`}
          aria-label={item.label} aria-current={tab === item.id ? "page" : undefined}
          title={item.label} data-label={item.label} onClick={() => selectTab(item.id)}>
          <ModuleIcon module={item.id} /><span className={styles.adminLabel}>{item.label}</span>
        </button>)}
      </nav>
    </aside>}
    <div className={styles.dashboardMain}>
    <header className={styles.header}>
      <div><p className={styles.eyebrow}>Tu espacio de trabajo</p><h1 className={styles.title}>Hola, <em>{user?.displayName.split(" ")[0] ?? "miembro"}.</em></h1></div>
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
      <div className={styles.workspaceIntro}><div><p className={styles.cardLabel}>Club Rotario / Gestión</p><h2>{tab === "resumen" ? "Vista general" : tabs.find(item => item.id === tab)?.label}</h2><p className={styles.sectionDescription}>{descriptions[tab]}</p></div><button className={styles.buttonQuiet} onClick={() => selectTab(tab === "agenda" ? "resumen" : "agenda")}>{tab === "agenda" ? "Ver resumen" : "Ver agenda"} ↗</button></div>

      <ActionFeedback message={feedback} error={feedbackError} />

      {tab === "auditoria" && snapshot.capabilities.canAudit && <PlatformAudit initialResult={auditResult} initialLoading={pending && !auditResult} />}

      {tab === "resumen" && <>
        <div className={styles.overviewMetrics}>
          {([
            ["propuestas", snapshot.proposals.length, "Propuestas visibles", "Ideas para transformar el club"],
            ["resumen", snapshot.tasks.filter(task => !["done", "cancelled"].includes(task.status)).length, "Tareas abiertas", "Compromisos por completar"],
            ["organizacion", snapshot.committees.filter(committee => committee.isActive).length, "Comités activos", "Equipos que hacen la diferencia"],
            ["mensajes", unreadMessages + unreadNotifications, "Sin leer", "Mensajes y notificaciones"],
          ] as const).map(([module, value, label, detail]) => <button type="button" key={label} className={styles.overviewMetric} onClick={() => { if (module === "resumen") document.getElementById("overview-tasks")?.scrollIntoView({ behavior: "smooth", block: "center" }); else selectTab(module); }}><span className={styles.metricHeading}><ModuleIcon module={module} />{label}<span>↗</span></span><strong>{value}</strong><small>{detail}</small></button>)}
        </div>
        <section className={styles.moduleGrid}>
        <PlatformEvents snapshot={snapshot} summary onOpenAgenda={() => setTab("agenda")} />
        <article className={`${styles.card} ${styles.welcomeCard}`}><p className={styles.cardLabel}>Personas de acción</p><h2 className={styles.cardTitle}>Tu próxima idea puede hacer la diferencia.</h2><p>Comparte una propuesta y empieza a construir junto al club.</p><button type="button" className={styles.button} onClick={() => selectTab("propuestas")}>Crear una propuesta ↗</button><span className={styles.welcomeDecoration} aria-hidden="true">✦</span></article>
        <article className={`${styles.card} ${styles.cardWide}`}><p className={styles.cardLabel}>Actividad reciente</p><h2 className={styles.cardTitle}>Lo que se está moviendo.</h2>{snapshot.activities.slice(0, 4).map(activity => <div className={styles.row} key={activity.id}><div><strong>{activity.title}</strong><small>{statusLabels[activity.status] ?? activity.status} · {activity.location ?? "Ubicación por confirmar"}</small></div></div>)}{snapshot.activities.length === 0 && <EmptyState>Las actividades aparecerán cuando coordinación las registre.</EmptyState>}</article>
        <article id="overview-tasks" className={`${styles.card} ${styles.taskOverview}`}><p className={styles.cardLabel}>Tareas abiertas</p><h2 className={styles.cardTitle}>Cada compromiso tiene un siguiente paso.</h2>{snapshot.tasks.filter(task => !["done", "cancelled"].includes(task.status)).slice(0, 5).map(task => <div className={styles.row} key={task.id}><div><strong>{task.title}</strong><small>{statusLabels[task.status] ?? task.status} · {task.dueAt ? `Vence ${formatDate(task.dueAt)}` : "Sin fecha límite"}</small></div><button type="button" className={styles.smallButtonQuiet} disabled={pending || !(snapshot.capabilities.canCoordinate || task.assigneeId === user?.id)} onClick={() => run(updateTaskStatusAction(task.id, task.status === "in_progress" ? "done" : "in_progress"))}>{task.status === "in_progress" ? "Marcar lista" : "Empezar"}</button></div>)}{snapshot.tasks.filter(task => !["done", "cancelled"].includes(task.status)).length === 0 && <EmptyState>Las tareas de propuestas y actividades aparecerán aquí.</EmptyState>}</article>
      </section></>}

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
            onVote={(choice: ProposalVoteChoice) => run(castProposalVoteAction(proposal.id, choice))}
            onEdit={(input,onSuccess)=>run(editProposalDraftAction({proposalId:proposal.id,...input}),onSuccess)}
            onReview={input=>run(reviewProposalAction({proposalId:proposal.id,...input}))} />)}
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

      {tab === "agenda" && <section className={styles.moduleGrid}><PlatformEvents snapshot={snapshot} /></section>}

      {tab === "actividades" && <ActivityManager activities={snapshot.activities} tasks={snapshot.tasks}
        members={snapshot.capabilities.canManageMembership ? snapshot.committeeCandidates : snapshot.memberDirectory} currentUserId={user?.id ?? ""} canManage={snapshot.capabilities.canCoordinate} />}

      {tab === "finanzas" && <FinanceModule canManage={snapshot.capabilities.canManageFinances} onOpenActivities={() => selectTab("actividades")} />}

      {tab === "fotografias" && snapshot.capabilities.canEdit && <MembershipPhotoManager onOpenMagazine={() => selectTab("revista")} />}

      {tab === "solicitudes" && <MembershipApplicationsModule
        canReview={snapshot.capabilities.canManageMembership}
        loadApplications={getMembershipApplicationsAction}
        updateStatus={updateMembershipApplicationStatusAction}
      />}

      {tab === "organizacion" && <OrganizationManager currentUserId={user?.id ?? ""} committees={snapshot.committees} tasks={snapshot.tasks}
        canManageMembers={snapshot.capabilities.canManageMembership} canManageCommittees={snapshot.capabilities.canManageCommittees}
        canManageOrganization={isAdministrator} />}

      {tab === "revista" && <section className={styles.moduleGrid}>
        <article className={`${styles.card} ${styles.cardWide} ${styles.storyArchiveCard}`}>
          <div className={styles.storyArchiveHeading}><div><p className={styles.cardLabel}>Archivo editorial</p><h2 className={styles.cardTitle}>Publicaciones del club</h2></div><span className={styles.storyCount}>{snapshot.stories.length} {snapshot.stories.length === 1 ? "historia" : "historias"}</span></div>
          {snapshot.stories.map(story => {
            const editorial = parseEditorialContent(story.content);
            const layoutName = editorialLayouts.find(layout => layout.id === editorial?.layoutId)?.name ?? "Formato anterior";
            return <article className={styles.storyAdminRow} key={story.id}>
              <div className={styles.storyAdminMeta}><span className={story.isPublic ? styles.storyPublished : styles.storyDraft}>{story.isPublic ? "Publicada" : statusLabels[story.status] ?? story.status}</span><span>{layoutName}</span><time>{story.publishedAt ? formatDate(story.publishedAt) : "Aún no publicada"}</time></div>
              <h3>{story.isPublic ? <Link href={`/revista/${story.slug}`}>{story.title}</Link> : story.title}</h3>
              <p>{story.excerpt ?? "Sin resumen todavía."}</p>
              <div className={styles.storyAdminActions}>
                {story.isPublic ? <Link href={`/revista/${story.slug}`} className={styles.storyTextLink}>Ver publicación ↗</Link> : <span className={styles.storyPrivateNote}>Solo equipo editorial</span>}
                {snapshot.capabilities.canEdit ? <StoryComposerDialog canPublish={snapshot.capabilities.canEdit} story={story} /> : null}
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
        <form className={styles.formCard} onSubmit={handleMessage}><p className={styles.cardLabel}>Nuevo mensaje</p><h2 className={styles.cardTitle}>Mantén el vínculo.</h2><label>Destinatario<select name="recipientUserId" required defaultValue=""><option value="" disabled>Selecciona una persona</option>{snapshot.capabilities.canBroadcast && <option value="all">Aviso a todo el club</option>}{(snapshot.capabilities.canManageMembership ? snapshot.committeeCandidates : snapshot.memberDirectory).filter(member => member.userId !== user?.id).map(member => <option key={member.userId} value={member.userId}>{member.name}</option>)}</select></label><label>Asunto<input name="subject" required minLength={3} maxLength={180} /></label><label>Mensaje<textarea name="body" required minLength={1} maxLength={8000} /></label><button className={styles.button} disabled={pending || snapshot.messagingSchema.state !== "ready"}>{pending ? "Enviando…" : "Enviar mensaje"}</button></form>
      </section>}

      {(snapshot.dataWarnings.length > 0) && <details className={styles.warnings}><summary>Algunas fuentes no respondieron</summary><ul>{snapshot.dataWarnings.map(warning => <li key={warning}>{warning}</li>)}</ul></details>}
    </section>
    <Link className={styles.back} href="/">← Volver al sitio público</Link>
  </div></main>;
}
