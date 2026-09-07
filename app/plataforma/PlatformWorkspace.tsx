"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { FormEvent, ReactNode } from "react";

import type { PlatformSnapshot } from "@/lib/platform";

import {
  assignCommitteeMemberAction,
  createActivityAction,
  createCommitteeAction,
  createEventAction,
  createProposalAction,
  createStoryAction,
  markMessageReadAction,
  markNotificationReadAction,
  rsvpEventAction,
  sendInternalMessageAction,
  setStoryPublicationAction,
  submitProposalAction,
  updateMembershipAction,
  updateTaskStatusAction,
  type PlatformActionResult,
} from "./actions";
import { SignOutButton } from "./SignOutButton";
import styles from "./platform.module.css";

type Tab = "resumen" | "propuestas" | "agenda" | "organizacion" | "revista" | "mensajes";

const tabs: Array<{ id: Tab; label: string }> = [
  { id: "resumen", label: "Resumen" },
  { id: "propuestas", label: "Propuestas" },
  { id: "agenda", label: "Agenda" },
  { id: "organizacion", label: "Organización" },
  { id: "revista", label: "Revista" },
  { id: "mensajes", label: "Mensajes" },
];

const roleLabels: Record<string, string> = {
  member: "Miembro",
  coordinator: "Coordinación",
  editor: "Edición",
  club_manager: "Gestión del club",
  admin: "Administración",
};

const statusLabels: Record<string, string> = {
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

export function PlatformWorkspace({ snapshot }: { snapshot: PlatformSnapshot }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("resumen");
  const [feedback, setFeedback] = useState("");
  const [feedbackError, setFeedbackError] = useState(false);
  const [pending, startTransition] = useTransition();
  const user = snapshot.user;

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

  function handleEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    run(createEventAction({
      title: String(data.get("title") ?? ""),
      summary: String(data.get("summary") ?? ""),
      description: String(data.get("description") ?? ""),
      kind: String(data.get("kind") ?? "encuentro"),
      startsAt: String(data.get("startsAt") ?? ""),
      endsAt: String(data.get("endsAt") ?? ""),
      venueName: String(data.get("venueName") ?? ""),
      venueAddress: String(data.get("venueAddress") ?? ""),
      locationUrl: String(data.get("locationUrl") ?? ""),
      capacity: String(data.get("capacity") ?? ""),
      status: data.get("status") === "published" ? "published" : "draft",
      isPublic: data.get("isPublic") === "on",
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

  function handleCommittee(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    run(createCommitteeAction({ name: String(data.get("name") ?? ""), description: String(data.get("description") ?? "") }));
    event.currentTarget.reset();
  }

  function handleAssignCommittee(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    run(assignCommitteeMemberAction({
      committeeId: String(data.get("committeeId") ?? ""),
      userId: String(data.get("userId") ?? ""),
      committeeRole: String(data.get("committeeRole") ?? "member") as "member" | "chair" | "secretary" | "treasurer",
    }));
    event.currentTarget.reset();
  }

  function handleStory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    run(createStoryAction({
      title: String(data.get("title") ?? ""),
      excerpt: String(data.get("excerpt") ?? ""),
      content: String(data.get("content") ?? ""),
      storyType: String(data.get("storyType") ?? "cronica"),
      status: data.get("status") === "published" ? "published" : "draft",
      isPublic: data.get("isPublic") === "on",
      coverImagePath: String(data.get("coverImagePath") ?? ""),
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
  const canPublish = snapshot.capabilities.canEdit;

  return <main className={styles.shell}><div className={styles.inner}>
    <header className={styles.header}>
      <div><p className={styles.eyebrow}>Plataforma del club · espacio interno</p><h1 className={styles.title}>Hola, <em>{user?.displayName.split(" ")[0] ?? "miembro"}.</em></h1></div>
      <div><p className={styles.identity}><strong>{user?.displayName}</strong><span className={styles.role}>{roleLabels[snapshot.membership?.role ?? "member"]}</span><span>Membresía activa</span></p><SignOutButton /></div>
    </header>

    <section className={styles.content}>
      <div className={styles.workspaceIntro}><div><p className={styles.cardLabel}>Centro de coordinación</p><h2>Ideas, personas y servicio en un mismo lugar.</h2></div><p>{snapshot.accessMessage} Los módulos se muestran según tu rol y tus permisos.</p></div>
      <nav className={styles.tabs} aria-label="Módulos de la plataforma">
        {tabs.map((item) => <button type="button" key={item.id} className={tab === item.id ? styles.tabActive : styles.tab} onClick={() => { setTab(item.id); setFeedback(""); }}>{item.label}{item.id === "mensajes" && (unreadNotifications + unreadMessages > 0) ? <span className={styles.tabBadge}>{unreadNotifications + unreadMessages}</span> : null}</button>)}
      </nav>
      <ActionFeedback message={feedback} error={feedbackError} />

      {tab === "resumen" && <section className={styles.moduleGrid}>
        <article className={`${styles.card} ${styles.cardWide}`}><p className={styles.cardLabel}>Próximos encuentros</p><h2 className={styles.cardTitle}>La agenda del club.</h2>{snapshot.events.filter(event => event.status !== "archived").slice(0, 4).map(event => <div className={styles.row} key={event.id}><div><strong>{event.title}</strong><small>{formatDate(event.startsAt, true)} · {event.venueName ?? "Lugar por confirmar"}</small></div><button type="button" className={styles.smallButton} disabled={pending} onClick={() => run(rsvpEventAction(event.id, "going"))}>{snapshot.eventRsvps[event.id] === "going" ? "Confirmado" : "Confirmar"}</button></div>)}{snapshot.events.length === 0 && <EmptyState>Aún no hay eventos internos cargados. Coordinación podrá añadir el próximo encuentro desde Agenda.</EmptyState>}</article>
        <article className={styles.card}><p className={styles.cardLabel}>Tu pulso</p><div className={styles.metric}><strong>{snapshot.proposals.length}</strong><span>propuestas visibles</span></div><div className={styles.metric}><strong>{snapshot.tasks.filter(task => task.status !== "done").length}</strong><span>tareas abiertas</span></div></article>
        <article className={styles.card}><p className={styles.cardLabel}>Avisos</p><h2 className={styles.cardTitle}>{unreadNotifications || "Sin"} {unreadNotifications === 1 ? "aviso nuevo" : "avisos nuevos"}.</h2><p className={styles.empty}>Revisa Mensajes para leer las novedades del club.</p></article>
        <article className={`${styles.card} ${styles.cardWide}`}><p className={styles.cardLabel}>Actividad reciente</p><h2 className={styles.cardTitle}>Lo que se está moviendo.</h2>{snapshot.activities.slice(0, 4).map(activity => <div className={styles.row} key={activity.id}><div><strong>{activity.title}</strong><small>{statusLabels[activity.status] ?? activity.status} · {activity.location ?? "Ubicación por confirmar"}</small></div></div>)}{snapshot.activities.length === 0 && <EmptyState>Las actividades aparecerán cuando coordinación las registre.</EmptyState>}</article>
        <article className={`${styles.card} ${styles.cardWide}`}><p className={styles.cardLabel}>Tareas abiertas</p><h2 className={styles.cardTitle}>Cada compromiso tiene un siguiente paso.</h2>{snapshot.tasks.slice(0, 5).map(task => <div className={styles.row} key={task.id}><div><strong>{task.title}</strong><small>{statusLabels[task.status] ?? task.status} · {task.dueAt ? `Vence ${formatDate(task.dueAt)}` : "Sin fecha límite"}</small></div><button type="button" className={styles.smallButtonQuiet} disabled={pending || task.status === "done"} onClick={() => run(updateTaskStatusAction(task.id, task.status === "in_progress" ? "done" : "in_progress"))}>{task.status === "in_progress" ? "Marcar lista" : "Empezar"}</button></div>)}{snapshot.tasks.length === 0 && <EmptyState>Las tareas de propuestas y actividades aparecerán aquí.</EmptyState>}</article>
      </section>}

      {tab === "propuestas" && <section className={styles.moduleGrid}>
        <article className={`${styles.card} ${styles.cardWide}`}><p className={styles.cardLabel}>Ideas del club</p><h2 className={styles.cardTitle}>Del deseo al plan.</h2>{snapshot.proposals.map(proposal => <div className={styles.row} key={proposal.id}><div><strong>{proposal.title}</strong><small>{statusLabels[proposal.status] ?? proposal.status} · {formatDate(proposal.createdAt)}</small><span>{proposal.summary}</span></div>{proposal.status === "draft" && proposal.createdBy === user?.id ? <button type="button" className={styles.smallButton} disabled={pending} onClick={() => run(submitProposalAction(proposal.id))}>Enviar a revisión</button> : null}</div>)}{snapshot.proposals.length === 0 && <EmptyState>Todavía no hay propuestas visibles. Puedes abrir la primera conversación en el formulario.</EmptyState>}</article>
        <form className={styles.formCard} onSubmit={handleProposal}><p className={styles.cardLabel}>Nueva propuesta</p><h2 className={styles.cardTitle}>Una idea concreta.</h2><label>Título<input name="title" required minLength={3} maxLength={180} placeholder="Ej. Recuperar una plaza" /></label><label>Resumen<textarea name="summary" required minLength={10} maxLength={1200} placeholder="¿Qué necesidad atiende y por qué ahora?" /></label><label>Detalles<textarea name="details" maxLength={4000} placeholder="Aliados, pasos iniciales, recursos…" /></label><button className={styles.button} disabled={pending}>{pending ? "Guardando…" : "Guardar borrador"}</button></form>
      </section>}

      {tab === "agenda" && <section className={styles.moduleGrid}>
        <article className={`${styles.card} ${styles.cardWide}`}><p className={styles.cardLabel}>Agenda interna</p><h2 className={styles.cardTitle}>Tiempo compartido, acción posible.</h2>{snapshot.events.map(event => <div className={styles.row} key={event.id}><div><strong>{event.title}</strong><small>{formatDate(event.startsAt, true)} · {event.kind} · {event.status}</small><span>{[event.venueName, event.venueAddress].filter(Boolean).join(" · ") || "Lugar por confirmar"}</span></div><div className={styles.rowActions}><button type="button" className={styles.smallButton} disabled={pending} onClick={() => run(rsvpEventAction(event.id, "going"))}>{snapshot.eventRsvps[event.id] === "going" ? "Voy" : "Voy"}</button><button type="button" className={styles.smallButtonQuiet} disabled={pending} onClick={() => run(rsvpEventAction(event.id, "maybe"))}>Quizá</button></div></div>)}{snapshot.events.length === 0 && <EmptyState>No hay eventos internos todavía.</EmptyState>}</article>
        {snapshot.capabilities.canCoordinate ? <><form className={styles.formCard} onSubmit={handleEvent}><p className={styles.cardLabel}>Crear encuentro</p><h2 className={styles.cardTitle}>Pon una fecha en el mapa.</h2><label>Título<input name="title" required minLength={3} maxLength={160} /></label><label>Tipo<select name="kind" defaultValue="encuentro"><option value="encuentro">Encuentro</option><option value="servicio">Servicio</option><option value="plataforma">Plataforma</option><option value="reunion">Reunión</option><option value="otro">Otra actividad</option></select></label><label>Inicio<input name="startsAt" type="datetime-local" required /></label><label>Fin<input name="endsAt" type="datetime-local" /></label><label>Lugar<input name="venueName" maxLength={180} /></label><label>Dirección<input name="venueAddress" maxLength={300} /></label><label>Descripción<textarea name="description" maxLength={8000} /></label><label className={styles.check}><input name="isPublic" type="checkbox" /> Hacerlo visible en la agenda pública</label><label>Publicación<select name="status" defaultValue="draft"><option value="draft">Guardar como borrador</option>{canPublish && <option value="published">Publicar ahora</option>}</select></label><button className={styles.button} disabled={pending}>{pending ? "Guardando…" : "Guardar encuentro"}</button></form><form className={styles.formCard} onSubmit={handleActivity}><p className={styles.cardLabel}>Nueva actividad</p><h2 className={styles.cardTitle}>Convierte el plan en movimiento.</h2><label>Nombre<input name="title" required minLength={3} maxLength={180} /></label><label>Inicio<input name="startsAt" type="datetime-local" /></label><label>Fin<input name="endsAt" type="datetime-local" /></label><label>Lugar<input name="location" maxLength={300} /></label><label>Descripción<textarea name="description" maxLength={4000} /></label><button className={styles.button} disabled={pending}>{pending ? "Guardando…" : "Guardar actividad"}</button></form></> : <article className={styles.card}><p className={styles.cardLabel}>Coordina con tu equipo</p><h2 className={styles.cardTitle}>La agenda se construye entre todos.</h2><EmptyState>Cuando tengas una fecha o una idea, compártela en Propuestas.</EmptyState></article>}
      </section>}

      {tab === "organizacion" && <section className={styles.moduleGrid}>
        <article className={`${styles.card} ${styles.cardWide}`}><p className={styles.cardLabel}>Estructura activa</p><h2 className={styles.cardTitle}>Comités, personas y responsabilidades.</h2>{snapshot.committees.map(committee => <div className={styles.committee} key={committee.id}><div className={styles.row}><div><strong>{committee.name}</strong><span>{committee.description ?? "Sin descripción todavía."}</span></div></div>{committee.members.length > 0 ? <ul>{committee.members.map(member => <li key={member.userId}><span>{member.name}</span><small>{member.role}</small></li>)}</ul> : <EmptyState>Aún no tiene integrantes asignados.</EmptyState>}</div>)}{snapshot.committees.length === 0 && <EmptyState>La estructura se mostrará cuando coordinación registre los comités del club.</EmptyState>}</article>
        {snapshot.capabilities.canCoordinate ? <form className={styles.formCard} onSubmit={handleCommittee}><p className={styles.cardLabel}>Nuevo comité</p><h2 className={styles.cardTitle}>Dale casa a una causa.</h2><label>Nombre<input name="name" required minLength={2} maxLength={140} placeholder="Ej. Servicio a la comunidad" /></label><label>Descripción<textarea name="description" maxLength={2000} /></label><button className={styles.button} disabled={pending}>{pending ? "Creando…" : "Crear comité"}</button></form> : null}
        {snapshot.capabilities.canCoordinate && snapshot.committees.length > 0 && snapshot.memberDirectory.length > 0 ? <form className={styles.formCard} onSubmit={handleAssignCommittee}><p className={styles.cardLabel}>Asignar responsabilidad</p><h2 className={styles.cardTitle}>Haz visible quién hace qué.</h2><label>Comité<select name="committeeId" defaultValue=""><option value="" disabled>Selecciona un comité</option>{snapshot.committees.map(committee => <option key={committee.id} value={committee.id}>{committee.name}</option>)}</select></label><label>Integrante<select name="userId" defaultValue=""><option value="" disabled>Selecciona una persona</option>{snapshot.memberDirectory.filter(member => member.userId !== user?.id).map(member => <option key={member.userId} value={member.userId}>{member.name}</option>)}</select></label><label>Responsabilidad<select name="committeeRole" defaultValue="member"><option value="member">Integrante</option><option value="chair">Presidencia</option><option value="secretary">Secretaría</option><option value="treasurer">Tesorería</option></select></label><button className={styles.button} disabled={pending}>{pending ? "Guardando…" : "Asignar integrante"}</button></form> : null}
        {snapshot.capabilities.canManageMembership ? <article className={`${styles.card} ${styles.cardWide}`}><p className={styles.cardLabel}>Solicitudes de membresía</p><h2 className={styles.cardTitle}>Personas que quieren servir.</h2>{snapshot.pendingMembers.map(member => <div className={styles.row} key={member.userId}><div><strong>{member.name}</strong><small>Solicitud recibida · {formatDate(member.createdAt)}</small></div><div className={styles.rowActions}><button type="button" className={styles.smallButton} disabled={pending} onClick={() => run(updateMembershipAction({ userId: member.userId, status: "active", role: "member" }))}>Activar</button><button type="button" className={styles.smallButtonQuiet} disabled={pending} onClick={() => run(updateMembershipAction({ userId: member.userId, status: "suspended", role: member.role }))}>Rechazar</button></div></div>)}{snapshot.pendingMembers.length === 0 && <EmptyState>No hay solicitudes pendientes.</EmptyState>}</article> : null}
      </section>}

      {tab === "revista" && <section className={styles.moduleGrid}>
        <article className={`${styles.card} ${styles.cardWide}`}><p className={styles.cardLabel}>Archivo editorial</p><h2 className={styles.cardTitle}>Lo que hacemos merece memoria.</h2>{snapshot.stories.map(story => <div className={styles.row} key={story.id}><div><strong>{story.title}</strong><small>{statusLabels[story.status] ?? story.status} · {story.isPublic ? "Visible públicamente" : "Solo equipo editorial"}</small><span>{story.excerpt ?? "Sin extracto todavía."}</span></div>{snapshot.capabilities.canEdit ? <button type="button" className={styles.smallButtonQuiet} disabled={pending} onClick={() => run(setStoryPublicationAction(story.id, !story.isPublic))}>{story.isPublic ? "Pasar a borrador" : "Publicar"}</button> : null}</div>)}{snapshot.stories.length === 0 && <EmptyState>El archivo propio está listo para recibir la primera crónica verificada.</EmptyState>}</article>
        {snapshot.capabilities.canEdit ? <form className={styles.formCard} onSubmit={handleStory}><p className={styles.cardLabel}>Nueva historia</p><h2 className={styles.cardTitle}>Cuenta lo que aprendimos.</h2><label>Título<input name="title" required minLength={3} maxLength={180} /></label><label>Tipo<select name="storyType" defaultValue="cronica"><option value="cronica">Crónica</option><option value="voces">Voces del club</option><option value="archivo">Archivo</option><option value="noticia">Noticia</option></select></label><label>Extracto<textarea name="excerpt" maxLength={1000} /></label><label>Contenido<textarea name="content" required minLength={1} maxLength={20000} /></label><label>Imagen existente<input name="coverImagePath" placeholder="/imagen.jpg o ruta del bucket" /></label><label className={styles.check}><input name="isPublic" type="checkbox" /> Visible en la revista pública</label><label>Publicación<select name="status" defaultValue="draft"><option value="draft">Guardar borrador</option>{canPublish && <option value="published">Publicar ahora</option>}</select></label><button className={styles.button} disabled={pending}>{pending ? "Guardando…" : "Guardar historia"}</button></form> : <article className={styles.card}><p className={styles.cardLabel}>Equipo editorial</p><h2 className={styles.cardTitle}>Una historia bien contada también sirve.</h2><EmptyState>El rol de edición puede preparar y publicar historias verificadas del club.</EmptyState></article>}
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
