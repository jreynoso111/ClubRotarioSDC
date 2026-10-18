"use client";

import Link from "next/link";
import Image from "next/image";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import type { FormEvent, ReactNode } from "react";

import type { PlatformProposal, PlatformSnapshot, ProposalVoteChoice } from "@/lib/platform";
import { PROPOSAL_LIMIT } from "@/lib/proposal-limits";
import { allowedWorkspaceTab, navigationItems, type WorkspaceTabId } from "@/lib/platform-navigation";
import { defaultAuditFilters, type AuditPageResult } from "@/lib/audit";

import {
  addMembershipApplicationNoteAction,
  createProposalAction,
  castProposalVoteAction,
  getAuditPageAction,
  getMembershipApplicationDetailAction,
  getMembershipApplicationsAction,
  markMessageReadAction,
  markNotificationReadAction,
  reviewMembershipApplicationAction,
  sendInternalMessageAction,
  setProposalVotingAction,
  submitProposalAction,
  updateTaskStatusAction,
  type PlatformActionResult,
} from "./actions";
import { deleteProposalDraftAction, editProposalDraftAction, reviewProposalAction } from "./proposal-management-actions";
import { OrganizationManager } from "./OrganizationManager";
import { ActivityManager } from "./ActivityManager";
import { createProposalTaskAction } from "./module-actions";
import { FinanceModule } from "./FinanceModule";
import { MembershipApplicationsModule } from "./MembershipApplicationsModule";
import { ProposalCard } from "./ProposalCard";
import { SignOutButton } from "./SignOutButton";
import { PlatformEvents } from "./PlatformEvents";
import { PlatformAudit } from "./PlatformAudit";
import { MagazineManager } from "./MagazineManager";
import { SitePhotoManager } from "./SitePhotoManager";
import { MfaNotice } from "./MfaNotice";
import { AccountSettings } from "./AccountSettings";
import { MemberAvatar } from "./MemberAvatar";
import { PlatformNavigation } from "./PlatformNavigation";
import { formatClubDate } from "@/lib/club-date";
import styles from "./platform.module.css";
import { PlatformVersionWatcher } from "./PlatformVersionWatcher";
const PlatformDiagnostics = dynamic(() => import("./PlatformDiagnostics").then(module => module.PlatformDiagnostics), { loading: () => <p role="status">Cargando diagnóstico…</p> });

const proposalFilters: Array<{ id: string; label: string; match: (proposal: PlatformProposal, userId: string) => boolean }> = [
  { id: "all", label: "Todas", match: () => true },
  { id: "voting", label: "Votación abierta", match: proposal => proposal.voting.isOpen },
  { id: "review", label: "Por revisar", match: proposal => proposal.status === "submitted" || proposal.status === "in_review" },
  { id: "approved", label: "Aprobadas", match: proposal => proposal.status === "approved" },
  { id: "rejected", label: "Devueltas", match: proposal => proposal.status === "rejected" },
  { id: "mine", label: "Mías", match: (proposal, userId) => proposal.createdBy === userId },
  { id: "archived", label: "Archivadas", match: proposal => proposal.status === "archived" },
];
const PROPOSAL_PAGE = 10;

type Tab = WorkspaceTabId;

const tabs: Array<{ id: Tab; label: string }> = [
  ...navigationItems,
  { id: "mensajes", label: "Mensajes" },
  // Opened from the header ("Mi cuenta"); not part of the shared sidebar order.
  { id: "perfil", label: "Mi cuenta" },
];

const administrationTabs: Tab[] = ["fotografias", "auditoria", "diagnostico"];

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
    perfil: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M4 21a8 8 0 0 1 16 0",
    auditoria: "M12 3l8 3v6c0 5-8 9-8 9s-8-4-8-9V6z M8 12l3 3 5-6",
    diagnostico: "M3 12h4l3-8 4 16 3-8h4",
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
  fotografias: "Cambia las fotos de todas las páginas del sitio; las de la Revista se editan en cada publicación.",
  mensajes: "Consulta tus avisos y conversaciones con los miembros del club.",
  perfil: "Actualiza tu nombre, tu foto, tu correo, tu contraseña y la seguridad de tu acceso.",
  auditoria: "Revisa quién cambió cada registro y compara sus valores anteriores y actuales.",
  diagnostico: "Analiza los errores de acceso y de la aplicación, y comprueba el estado del sistema.",
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
  return formatClubDate(value, withTime);
}

function ActionFeedback({ message, error }: { message: string; error: boolean }) {
  if (!message) return null;
  return <p className={error ? styles.feedbackError : styles.feedbackSuccess} role={error ? "alert" : "status"}>{message}</p>;
}

function EmptyState({ children }: { children: ReactNode }) {
  return <p className={styles.empty}>{children}</p>;
}

// A tab the snapshot allows; used for the address bar and notification links.
function allowedTab(id: string | null | undefined, snapshot: PlatformSnapshot): Tab | null {
  return allowedWorkspaceTab(id, snapshot.capabilities);
}

// Notifications link to a platform tab as /plataforma?tab=<id>.
function notificationTab(href: string | null) {
  const match = href?.match(/^\/plataforma\?tab=([a-z]+)$/);
  return match && tabs.some(item => item.id === match[1]) ? match[1] : null;
}

function NotificationBell({ notifications, disabled, onMarkRead, onViewAll, onOpen, messagingSchema }: {
  notifications: PlatformSnapshot["notifications"];
  disabled: boolean;
  onMarkRead: (id: string) => void;
  onViewAll: () => void;
  onOpen: (tab: string) => void;
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
          {notificationTab(notification.href) ? <button type="button" className={styles.notificationReadButton}
            onClick={() => { setOpen(false); onOpen(notificationTab(notification.href)!); if (!notification.readAt) onMarkRead(notification.id); }}>Abrir</button> : null}
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

export function PlatformWorkspace({ snapshot, initialTab }: { snapshot: PlatformSnapshot; initialTab?: string }) {
  const router = useRouter();
  // The open tab lives in the address (?tab=), so a refresh or a shared link reopens it.
  const [tab, setTab] = useState<Tab>(() => allowedTab(initialTab, snapshot) ?? "resumen");
  const [administrationExpanded, setAdministrationExpanded] = useState(() => administrationTabs.includes(tab));
  const [feedback, setFeedback] = useState("");
  const [savingProposal, setSavingProposal] = useState(false);
  const [proposalFilter, setProposalFilter] = useState("all");
  const [proposalPage, setProposalPage] = useState(1);
  const [feedbackError, setFeedbackError] = useState(false);
  const [pending, startTransition] = useTransition();
  const [auditResult, setAuditResult] = useState<AuditPageResult | null>(null);
  const auditRequest = useRef(0);
  const user = snapshot.user;
  const isSystemAccount = snapshot.membership?.role === "admin";

  function loadAudit() {
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

  function selectTab(next: Tab) {
    if (next === tab) return;
    setTab(next);
    setFeedback("");
    window.history.replaceState(null, "", next === "resumen" ? "/plataforma" : `/plataforma?tab=${next}`);
    if (next === "auditoria" && snapshot.capabilities.canAudit) loadAudit();
  }

  // A refresh on the audit tab loads its first page, as opening the tab does.
  const auditOpenedOnLoad = useRef(tab === "auditoria" && snapshot.capabilities.canAudit);
  useEffect(() => {
    if (!auditOpenedOnLoad.current) return;
    auditOpenedOnLoad.current = false;
    loadAudit();
  }, []);

  function run(action: Promise<PlatformActionResult>, onSuccess?: () => void) {
    setSavingProposal(false);
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
    // After run(): it clears the flag for every other action.
    setSavingProposal(true);
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
        <p className={styles.noticeMessage}>{snapshot.access === "suspended"
          ? "Mientras la suspensión siga vigente no tendrás acceso a los módulos del club. Para revisarla, comunícate con la directiva del club."
          : "La plataforma se abrirá cuando el club confirme tu membresía. Si tienes dudas sobre tu solicitud, comunícate con la persona que te invitó o con la directiva del club."}</p>
        <Link className={styles.button} href="/nosotros">Conocer el club →</Link>
      </div></section>
      <Link className={styles.back} href="/">← Volver al sitio público</Link>
    </div></main>;
  }

  const unreadNotifications = snapshot.notifications.filter((item) => !item.readAt).length;
  const visibleProposals = snapshot.proposals.filter(proposal =>
    (proposalFilters.find(filter => filter.id === proposalFilter) ?? proposalFilters[0]).match(proposal, user?.id ?? ""));
  // Coordination follows every open task; everyone else sees the ones assigned to them.
  const overviewTasks = snapshot.tasks.filter(task => !["done", "cancelled"].includes(task.status)
    && (snapshot.capabilities.canCoordinate || task.assigneeId === user?.id));
  const unreadMessages = snapshot.messages.filter((item) => item.direction === "inbox" && !item.readAt).length;
  const needsSecondFactor = snapshot.security.state === "enroll" || snapshot.security.state === "verify";
  const isAdministrator = snapshot.membership?.role === "admin" && !needsSecondFactor;
  const availableTabs = navigationItems.filter(item =>
    (item.id !== "diagnostico" || snapshot.capabilities.canAudit) &&
    (item.id !== "auditoria" || snapshot.capabilities.canAudit) &&
    (item.id !== "fotografias" || snapshot.capabilities.canEdit)
  );
  const mainTabs = availableTabs.filter(item => !isAdministrator || !administrationTabs.includes(item.id));
  const adminTabs = isAdministrator ? availableTabs.filter(item => administrationTabs.includes(item.id)) : [];

  return <main className={`${styles.shell} ${styles.dashboard} ${isAdministrator ? styles.dashboardWithAdmin : ""}`}>
    <PlatformVersionWatcher />
    <aside className={styles.sidebar}>
      <Link href="/" className={styles.clubBrand}><Image src="/club-santo-domingo-colonial-logo.png" alt="Rotary Club Santo Domingo Colonial" width={1401} height={310} preload /></Link>
      <div className={styles.sideSection}>ESPACIO DE TRABAJO</div>
      <PlatformNavigation initial={snapshot.navigation} selected={tab} canReorder={isAdministrator}
        items={mainTabs.map(item => ({ ...item, icon: <ModuleIcon module={item.id} /> }))} onSelect={selectTab} />
      <div className={styles.sidebarFooter}><span className={styles.memberDot} /> {isSystemAccount ? "Acceso administrativo" : "Membresía activa"}<p>Personas de acción.<br />Un club, muchas formas de servir.</p><Link href="/">Visitar sitio público ↗</Link></div>
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
        <p className={styles.identity}><strong>{user?.displayName}</strong><span className={styles.role}>{roleLabels[snapshot.membership?.role ?? "member"]}</span><span>{isSystemAccount ? "Cuenta del sistema" : "Membresía activa"}</span></p>
        <div className={styles.headerActions}>
          <NotificationBell notifications={snapshot.notifications} messagingSchema={snapshot.messagingSchema} disabled={pending}
            onMarkRead={id => run(markNotificationReadAction(id))}
            onViewAll={() => selectTab("mensajes")}
            onOpen={next => selectTab(next as Tab)} />
          <button type="button" className={styles.accountButton} aria-current={tab === "perfil" ? "page" : undefined}
            onClick={() => selectTab("perfil")}>
            <MemberAvatar userId={user?.id ?? ""} name={user?.displayName ?? "Miembro"} avatarVersion={user?.avatarVersion ?? null} className={styles.accountAvatar} />
            <span>Mi cuenta</span>
          </button>
          <button type="button" className={`${styles.notificationButton} ${styles.messagesButton}`} aria-current={tab === "mensajes" ? "page" : undefined}
            aria-label={unreadMessages > 0 ? `Mensajes, ${unreadMessages} sin leer` : "Mensajes"}
            onClick={() => selectTab("mensajes")}>
            <ModuleIcon module="mensajes" /><span>Mensajes</span>
            {unreadMessages > 0 ? <span className={styles.notificationBadge}>{unreadMessages > 99 ? "99+" : unreadMessages}</span> : null}
          </button>
          <SignOutButton />
        </div>
      </div>
    </header>
    {needsSecondFactor && <MfaNotice state={snapshot.security.state === "enroll" ? "enroll" : "verify"} />}

    <section className={styles.content}>
      <div className={styles.workspaceIntro}><div><p className={styles.cardLabel}>Club Rotario / Gestión</p><h2>{tab === "resumen" ? "Vista general" : tabs.find(item => item.id === tab)?.label}</h2><p className={styles.sectionDescription}>{descriptions[tab]}</p></div><button className={styles.buttonQuiet} onClick={() => selectTab(tab === "agenda" ? "resumen" : "agenda")}>{tab === "agenda" ? "Ver resumen" : "Ver agenda"} ↗</button></div>

      <ActionFeedback message={pending && feedback && !feedbackError ? "Actualizando la información…" : feedback} error={feedbackError} />

      {tab === "auditoria" && snapshot.capabilities.canAudit && <PlatformAudit initialResult={auditResult} initialLoading={pending && !auditResult} />}
      {tab === "diagnostico" && snapshot.capabilities.canAudit && <PlatformDiagnostics />}

      {tab === "resumen" && <>
        <div className={styles.overviewMetrics}>
          {([
            ["propuestas", snapshot.proposals.length, "Propuestas visibles", "Ideas para transformar el club"],
            ["resumen", overviewTasks.length, snapshot.capabilities.canCoordinate ? "Tareas abiertas" : "Mis tareas abiertas", "Compromisos por completar"],
            ["organizacion", snapshot.committees.filter(committee => committee.isActive).length, "Comités activos", "Equipos que hacen la diferencia"],
            ["mensajes", unreadMessages + unreadNotifications, "Sin leer", "Mensajes y notificaciones"],
          ] as const).map(([module, value, label, detail]) => <button type="button" key={label} className={styles.overviewMetric} onClick={() => { if (module === "resumen") document.getElementById("overview-tasks")?.scrollIntoView({ behavior: "smooth", block: "center" }); else selectTab(module); }}><span className={styles.metricLabel}>{label}</span><strong>{value}</strong><small>{detail}</small><span className={styles.metricLink} aria-hidden="true">→</span></button>)}
        </div>
        <section className={styles.moduleGrid}>
        <PlatformEvents snapshot={snapshot} summary onOpenAgenda={() => setTab("agenda")} />
        <article className={`${styles.card} ${styles.welcomeCard}`}><p className={styles.cardLabel}>Personas de acción</p><h2 className={styles.cardTitle}>Tu próxima idea puede hacer la diferencia.</h2><p>Comparte una propuesta y empieza a construir junto al club.</p><button type="button" className={styles.button} onClick={() => selectTab("propuestas")}>Crear una propuesta</button></article>
        <article className={`${styles.card} ${styles.cardWide}`}><p className={styles.cardLabel}>Actividad reciente</p><h2 className={styles.cardTitle}>Lo que se está moviendo.</h2>{snapshot.activities.slice(0, 4).map(activity => <div className={styles.row} key={activity.id}><div><strong>{activity.title}</strong><small>{statusLabels[activity.status] ?? activity.status} · {activity.location ?? "Ubicación por confirmar"}</small></div></div>)}{snapshot.activities.length === 0 && <EmptyState>Las actividades aparecerán cuando coordinación las registre.</EmptyState>}</article>
        <article id="overview-tasks" className={`${styles.card} ${styles.taskOverview}`}><p className={styles.cardLabel}>{snapshot.capabilities.canCoordinate ? "Tareas abiertas" : "Mis tareas abiertas"}</p><h2 className={styles.cardTitle}>Cada compromiso tiene un siguiente paso.</h2>{overviewTasks.slice(0, 5).map(task => <div className={styles.row} key={task.id}><div><strong>{task.title}</strong><small>{statusLabels[task.status] ?? task.status} · {task.dueAt ? `Vence ${formatDate(task.dueAt)}` : "Sin fecha límite"}</small></div><button type="button" className={styles.smallButtonQuiet} disabled={pending} onClick={() => run(updateTaskStatusAction(task.id, task.status === "in_progress" ? "done" : "in_progress"))}>{task.status === "in_progress" ? "Marcar lista" : "Empezar"}</button></div>)}{overviewTasks.length === 0 && <EmptyState>{snapshot.capabilities.canCoordinate ? "Las tareas de propuestas y actividades aparecerán aquí." : "Cuando te asignen una tarea aparecerá aquí."}</EmptyState>}</article>
      </section></>}

      {tab === "propuestas" && <section className={styles.moduleGrid}>
        <article className={`${styles.card} ${styles.cardWide}`}>
          <p className={styles.cardLabel}>Ideas del club</p><h2 className={styles.cardTitle}>Del deseo al plan.</h2>
          {snapshot.proposalVotingSchema.state !== "ready" && snapshot.proposalVotingSchema.message
            ? <p className={styles.proposalModuleNotice} role="status">{snapshot.proposalVotingSchema.message}</p>
            : null}
          <div className={styles.proposalFilters} role="group" aria-label="Filtrar propuestas">{proposalFilters.map(filter => {
            const count = snapshot.proposals.filter(proposal => filter.match(proposal, user?.id ?? "")).length;
            return filter.id === "all" || count > 0 ? <button type="button" key={filter.id} aria-pressed={proposalFilter === filter.id}
              className={proposalFilter === filter.id ? styles.proposalFilterActive : styles.proposalFilter}
              onClick={() => { setProposalFilter(filter.id); setProposalPage(1); }}>{filter.label} <span>{count}</span></button> : null;
          })}</div>
          {visibleProposals.slice(0, proposalPage * PROPOSAL_PAGE).map(proposal => <ProposalCard key={proposal.id} proposal={proposal}
            metadata={`${formatDate(proposal.createdAt)} · Autor: ${proposal.authorName}`}
            currentUserId={user?.id ?? ""}
            canManageVoting={snapshot.proposalVotingSchema.state === "ready" && (snapshot.capabilities.canCoordinate || snapshot.capabilities.canManageClub)}
            pending={pending}
            onSubmit={() => run(submitProposalAction(proposal.id))}
            onToggleVoting={enabled => run(setProposalVotingAction(proposal.id, enabled))}
            onVote={(choice: ProposalVoteChoice) => run(castProposalVoteAction(proposal.id, choice))}
            onEdit={(input,onSuccess)=>run(editProposalDraftAction({proposalId:proposal.id,...input}),onSuccess)}
            onReview={input=>run(reviewProposalAction({proposalId:proposal.id,...input}))}
            onDelete={() => run(deleteProposalDraftAction(proposal.id))}
            tasks={snapshot.tasks.filter(task => task.proposalId === proposal.id)}
            members={snapshot.memberDirectory}
            onCreateTask={(input, onSuccess) => run(createProposalTaskAction({ proposalId: proposal.id, ...input }), onSuccess)} />)}
          {visibleProposals.length > proposalPage * PROPOSAL_PAGE ? <button type="button" className={styles.buttonQuiet}
            onClick={() => setProposalPage(page => page + 1)}>Ver más ({visibleProposals.length - proposalPage * PROPOSAL_PAGE} restantes)</button> : null}
          {snapshot.proposals.length >= PROPOSAL_LIMIT ? <p className={styles.proposalVotingHelp}>Se muestran las {PROPOSAL_LIMIT} propuestas más recientes.</p> : null}
          {snapshot.proposals.length === 0 && <EmptyState>Todavía no hay propuestas visibles. Puedes abrir la primera conversación en el formulario.</EmptyState>}
          {snapshot.proposals.length > 0 && visibleProposals.length === 0 && <EmptyState>No hay propuestas con este filtro.</EmptyState>}
        </article>
        <form className={styles.formCard} onSubmit={handleProposal}>
          <p className={styles.cardLabel}>Nueva propuesta</p><h2 className={styles.cardTitle}>Una idea concreta.</h2>
          <p className={styles.empty}>Se guardará tu membresía como autor: {user?.displayName ?? "Miembro del club"}.</p>
          <label>Título<input name="title" required minLength={3} maxLength={180} placeholder="Ej. Recuperar una plaza" /></label>
          <label>Resumen<textarea name="summary" required minLength={10} maxLength={1200} placeholder="¿Qué necesidad atiende y por qué ahora?" /></label>
          <label>Detalles<textarea name="details" maxLength={4000} placeholder="Aliados, pasos iniciales, recursos…" /></label>
          <button className={styles.button} disabled={pending}>{pending && savingProposal ? "Guardando…" : "Guardar borrador"}</button>
        </form>
      </section>}

      {tab === "agenda" && <PlatformEvents snapshot={snapshot} />}

      {tab === "actividades" && <ActivityManager activities={snapshot.activities} tasks={snapshot.tasks}
        members={snapshot.capabilities.canManageMembership ? snapshot.committeeCandidates : snapshot.memberDirectory} currentUserId={user?.id ?? ""} canManage={snapshot.capabilities.canCoordinate} canDelete={snapshot.capabilities.canManageClub} />}

      {tab === "finanzas" && <FinanceModule canManage={snapshot.capabilities.canManageFinances} onOpenActivities={() => selectTab("actividades")} />}

      {tab === "fotografias" && snapshot.capabilities.canEdit && <SitePhotoManager onOpenMagazine={() => selectTab("revista")} />}

      {tab === "solicitudes" && <MembershipApplicationsModule
        loadApplications={getMembershipApplicationsAction}
        reviewApplication={reviewMembershipApplicationAction}
        loadDetail={getMembershipApplicationDetailAction}
        addNote={addMembershipApplicationNoteAction}
      />}

      {tab === "organizacion" && <OrganizationManager currentUserId={user?.id ?? ""} committees={snapshot.committees} tasks={snapshot.tasks}
        canManageMembers={snapshot.capabilities.canManageMembership} canManageCommittees={snapshot.capabilities.canManageCommittees}
        canManageOrganization={isAdministrator} onOpenApplications={() => selectTab("solicitudes")} />}

      {tab === "revista" && <MagazineManager canWrite={snapshot.capabilities.canWriteStories} canPublish={snapshot.capabilities.canPublishStories} />}

      {tab === "perfil" && user && <AccountSettings user={user} />}

      {tab === "mensajes" && <section className={styles.moduleGrid}>
        <article className={`${styles.card} ${styles.cardWide}`}><p className={styles.cardLabel}>Avisos y conversaciones</p><h2 className={styles.cardTitle}>Lo importante, cerca.</h2>{snapshot.notifications.slice(0, 8).map(notification => <div className={styles.row} key={notification.id}><div><strong>{notification.title}</strong><small>{formatDate(notification.createdAt, true)} · {notification.readAt ? "Leído" : "Sin leer"}</small><span>{notification.body}</span></div>{!notification.readAt ? <button type="button" className={styles.smallButtonQuiet} disabled={pending} onClick={() => run(markNotificationReadAction(notification.id))}>Marcar leído</button> : null}</div>)}{snapshot.notifications.length === 0 && <EmptyState>No hay avisos nuevos.</EmptyState>}{snapshot.messages.slice(0, 8).map(message => <div className={styles.message} key={`${message.direction}-${message.id}`}><div><span className={styles.messageTag}>{message.direction === "inbox" ? "Recibido" : "Enviado"}</span><strong>{message.subject}</strong><small>{message.direction === "sent" ? `Para ${message.recipientNames.join(", ") || "destinatario no disponible"}` : message.senderName} · {formatDate(message.createdAt, true)}</small></div><p>{message.body}</p>{message.direction === "inbox" && !message.readAt ? <button type="button" className={styles.smallButtonQuiet} disabled={pending} onClick={() => run(markMessageReadAction(message.id))}>Marcar leído</button> : null}</div>)}{snapshot.messages.length === 0 && snapshot.messagingSchema.state === "ready" && <EmptyState>Tu buzón todavía está vacío.</EmptyState>}{snapshot.messagingSchema.state !== "ready" && <p className={styles.noticeMessage}>{snapshot.messagingSchema.message}</p>}</article>
        <form className={styles.formCard} onSubmit={handleMessage}><p className={styles.cardLabel}>Nuevo mensaje</p><h2 className={styles.cardTitle}>Mantén el vínculo.</h2><label>Destinatario<select name="recipientUserId" required defaultValue=""><option value="" disabled>Selecciona una persona</option>{snapshot.capabilities.canBroadcast && <option value="all">Aviso a todo el club</option>}{(snapshot.capabilities.canManageMembership ? snapshot.committeeCandidates : snapshot.memberDirectory).filter(member => member.userId !== user?.id).map(member => <option key={member.userId} value={member.userId}>{member.name}</option>)}</select></label><label>Asunto<input name="subject" required minLength={3} maxLength={180} /></label><label>Mensaje<textarea name="body" required minLength={1} maxLength={8000} /></label><button className={styles.button} disabled={pending || snapshot.messagingSchema.state !== "ready"}>{pending ? "Enviando…" : "Enviar mensaje"}</button></form>
      </section>}

      {(snapshot.dataWarnings.length > 0) && <details className={styles.warnings}><summary>Algunas fuentes no respondieron</summary><ul>{snapshot.dataWarnings.map(warning => <li key={warning}>{warning}</li>)}</ul></details>}
    </section>
    <Link className={styles.back} href="/">← Volver al sitio público</Link>
  </div></main>;
}
