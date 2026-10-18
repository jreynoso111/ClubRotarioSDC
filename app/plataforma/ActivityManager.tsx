"use client";

import { useCallback, useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { PlatformActivity, PlatformDirectoryMember, PlatformTask } from "@/lib/platform";
import { updateTaskStatusAction, type PlatformActionResult } from "./actions";
import {
  addTaskCommentAction, createEventFromActivityAction, createManagedActivityAction, createTaskAction, deleteActivityAction,
  deleteTaskAction, getActivityWorkspaceAction, updateActivityAction, updateTaskAction,
  type ActivityEventLink, type ActivityWorkspace, type TaskComment,
} from "./module-actions";
import { formatClubDate } from "@/lib/club-date";
import styles from "./management.module.css";

const activityStates = { planned: "Planificada", active: "En ejecución", completed: "Terminada", cancelled: "Cancelada" };
const taskStates = { todo: "Por hacer", in_progress: "En curso", blocked: "Bloqueada", done: "Terminada", cancelled: "Cancelada" };
const priorities = { low: "Baja", normal: "Normal", high: "Alta", urgent: "Urgente" };
const eventStates: Record<string, string> = { draft: "borrador", published: "publicado", cancelled: "cancelado", archived: "archivado" };
const openStates = ["todo", "in_progress", "blocked"];
type TaskStatus = keyof typeof taskStates;
function dateLabel(value: string | null) {
  return value ? formatClubDate(value) : "Por definir";
}
function localDate(value: string | null) {
  if (!value) return "";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santo_Domingo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(value));
  const fields = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${fields.year}-${fields.month}-${fields.day}T${fields.hour}:${fields.minute}`;
}
function formDate(value: FormDataEntryValue | null) { return value ? `${String(value)}-04:00` : ""; }

function TaskFields({ members, task }: { members: PlatformDirectoryMember[]; task?: PlatformTask }) {
  return <>
    <label>Nombre de la tarea<input name="title" required minLength={2} maxLength={180} defaultValue={task?.title ?? ""} placeholder="Ej. Confirmar los materiales de la jornada" /></label>
    <label>Instrucciones<textarea name="description" maxLength={4000} defaultValue={task?.description ?? ""} placeholder="Pasos y resultado esperado" /></label>
    <div className={styles.twoColumns}><label>Responsable<select name="assigneeId" defaultValue={task?.assigneeId ?? ""}><option value="">Sin asignar</option>{task?.assigneeId && !members.some(member => member.userId === task.assigneeId) && <option value={task.assigneeId}>Conservar responsable anterior</option>}{members.map(member => <option key={member.userId} value={member.userId}>{member.name}</option>)}</select></label><label>Prioridad<select name="priority" defaultValue={task?.priority ?? "normal"}>{Object.entries(priorities).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></div>
    <label>Fecha límite · hora de Santo Domingo<input name="dueAt" type="datetime-local" defaultValue={localDate(task?.dueAt ?? null)} /></label>
    <p className={styles.muted}>La persona asignada recibe un aviso y un recordatorio el día anterior al vencimiento.</p>
  </>;
}

export function ActivityManager({ activities: initialActivities, tasks: initialTasks, members: initialMembers, currentUserId, canManage, canDelete = false }: { activities: PlatformActivity[]; tasks: PlatformTask[]; members: PlatformDirectoryMember[]; currentUserId: string; canManage: boolean; canDelete?: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<PlatformActionResult | null>(null);
  const [savingForm, setSavingForm] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [taskFormId, setTaskFormId] = useState<string | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [view, setView] = useState<"activities" | "mine">("activities");
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [workspace, setWorkspace] = useState<ActivityWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  // Fixed per visit: enough to mark overdue tasks without impure renders.
  const [now] = useState(() => Date.now());
  const loadVersion = useRef(0);
  const activities = workspace?.activities ?? initialActivities;
  const tasks = workspace?.tasks ?? initialTasks;
  const members = workspace?.members ?? initialMembers;
  const comments: TaskComment[] = workspace?.comments ?? [];
  const events: ActivityEventLink[] = workspace?.events ?? [];
  const names = new Map(members.map(member => [member.userId, member.name]));
  const visible = activities.filter(activity => (filter === "all" || activity.status === filter) && activity.title.toLocaleLowerCase("es").includes(query.toLocaleLowerCase("es")));
  const myTasks = tasks.filter(task => task.assigneeId === currentUserId && openStates.includes(task.status))
    .sort((a, b) => (a.dueAt ?? "9999").localeCompare(b.dueAt ?? "9999"));
  const leads = (activityId: string | null) => Boolean(activityId) && activities.some(activity => activity.id === activityId && activity.leadId === currentUserId);
  const canManageTasksOf = (activityId: string | null) => canManage || leads(activityId);
  const isOverdue = (task: PlatformTask) => Boolean(task.dueAt) && openStates.includes(task.status) && new Date(task.dueAt!).getTime() < now;

  const reloadWorkspace = useCallback(async () => {
    const version = ++loadVersion.current;
    setLoading(true);
    try {
      const result = await getActivityWorkspaceAction();
      if (version !== loadVersion.current) return;
      if (result.ok && result.workspace) { setWorkspace(result.workspace); setLoadError(""); }
      else setLoadError(result.message);
    } catch { if (version === loadVersion.current) setLoadError("No se pudo cargar la lista completa. Inténtalo nuevamente."); }
    finally { if (version === loadVersion.current) setLoading(false); }
  }, []);
  useEffect(() => {
    let active = true;
    const version = ++loadVersion.current;
    void getActivityWorkspaceAction().then(result => {
      if (!active || version !== loadVersion.current) return;
      if (result.ok && result.workspace) { setWorkspace(result.workspace); setLoadError(""); }
      else setLoadError(result.message);
    }).catch(() => { if (active && version === loadVersion.current) setLoadError("No se pudo cargar la lista completa. Inténtalo nuevamente."); })
      .finally(() => { if (active && version === loadVersion.current) setLoading(false); });
    return () => { active = false; };
  }, []);

  // The message appears once the refreshed list is on screen.
  function run(action: () => Promise<PlatformActionResult>, after?: () => void, form: string | null = null) {
    setSavingForm(form);
    setFeedback(null);
    startTransition(async () => {
      try {
        const result = await action();
        if (result.ok) { after?.(); await reloadWorkspace(); router.refresh(); }
        setFeedback(result);
      } catch { setFeedback({ ok: false, message: "No se pudo guardar. El formulario conserva tus datos para intentarlo nuevamente." }); }
      finally { setSavingForm(null); }
    });
  }

  function saveActivity(event: FormEvent<HTMLFormElement>, activity?: PlatformActivity) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const status = String(data.get("status") ?? "") as keyof typeof activityStates;
    const input = { title: String(data.get("title") ?? ""), description: String(data.get("description") ?? ""), startsAt: formDate(data.get("startsAt")), endsAt: formDate(data.get("endsAt")), location: String(data.get("location") ?? "") };
    if (activity) {
      const open = tasks.filter(task => task.activityId === activity.id && openStates.includes(task.status)).length;
      const closing = (status === "completed" || status === "cancelled") && !["completed", "cancelled"].includes(activity.status);
      if (closing && open > 0 && !window.confirm(`Esta actividad tiene ${open} ${open === 1 ? "tarea abierta" : "tareas abiertas"}. Al cerrarla se ${open === 1 ? "cancelará" : "cancelarán"}. ¿Continuar?`)) return;
      run(() => updateActivityAction({ ...input, activityId: activity.id, status, leadId: String(data.get("leadId") ?? "") }), () => setEditingId(null), `activity-${activity.id}`);
    } else run(() => createManagedActivityAction(input), () => setCreating(false), "activity-new");
  }

  function saveTask(event: FormEvent<HTMLFormElement>, activityId: string | null, task?: PlatformTask) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const input = { title: String(data.get("title") ?? ""), description: String(data.get("description") ?? ""), assigneeId: String(data.get("assigneeId") ?? ""), priority: String(data.get("priority")) as keyof typeof priorities, dueAt: formDate(data.get("dueAt")) };
    if (task) run(() => updateTaskAction({ ...input, taskId: task.id }), () => setEditingTaskId(null), `task-${task.id}`);
    else if (activityId) run(() => createTaskAction({ ...input, activityId }), () => setTaskFormId(null), `task-new-${activityId}`);
  }

  function changeStatus(task: PlatformTask, status: TaskStatus) {
    if (status === "blocked") {
      const reason = window.prompt("¿Qué bloquea esta tarea? El motivo quedará como comentario para coordinación.");
      if (!reason || reason.trim().length < 5) { setFeedback({ ok: false, message: "Para bloquear la tarea escribe el motivo (al menos 5 caracteres)." }); return; }
      run(() => updateTaskStatusAction(task.id, status, reason));
    } else run(() => updateTaskStatusAction(task.id, status));
  }

  function activityForm(activity?: PlatformActivity) {
    const key = activity ? `activity-${activity.id}` : "activity-new";
    return <form className={styles.form} onSubmit={event => saveActivity(event, activity)}>
      <label>Nombre de la actividad<input name="title" required minLength={3} maxLength={180} defaultValue={activity?.title ?? ""} placeholder="Ej. Jornada de servicio en la Ciudad Colonial" /></label>
      <label>Objetivo y descripción<textarea name="description" maxLength={4000} defaultValue={activity?.description ?? ""} placeholder="Qué se realizará y a quién beneficiará" /></label>
      <div className={styles.twoColumns}><label>Inicio · hora de Santo Domingo<input name="startsAt" type="datetime-local" defaultValue={localDate(activity?.startsAt ?? null)} /></label><label>Cierre · hora de Santo Domingo<input name="endsAt" type="datetime-local" defaultValue={localDate(activity?.endsAt ?? null)} /></label></div>
      <label>Lugar<input name="location" maxLength={300} defaultValue={activity?.location ?? ""} placeholder="Lugar o punto de encuentro" /></label>
      {activity && <div className={styles.twoColumns}><label>Estado<select name="status" defaultValue={activity.status}>{Object.entries(activityStates).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label>Responsable de la actividad<select name="leadId" defaultValue={activity.leadId ?? ""}><option value="">Sin asignar</option>{activity.leadId && !members.some(member => member.userId === activity.leadId) && <option value={activity.leadId}>Conservar responsable anterior</option>}{members.map(member => <option key={member.userId} value={member.userId}>{member.name}</option>)}</select></label></div>}
      {activity && <p className={styles.muted}>El responsable recibe un aviso y puede organizar las tareas de esta actividad. Terminar o cancelar la actividad cancela sus tareas abiertas.</p>}
      <div className={styles.formButtons}><button className={styles.button} disabled={pending}>{savingForm === key ? "Guardando…" : activity ? "Guardar actividad" : "Crear actividad"}</button><button type="button" className={styles.quietButton} onClick={() => activity ? setEditingId(null) : setCreating(false)}>Cancelar</button></div>
    </form>;
  }

  function taskComments(task: PlatformTask) {
    const list = comments.filter(comment => comment.taskId === task.id);
    const canComment = canManageTasksOf(task.activityId) || task.assigneeId === currentUserId;
    if (!list.length && !canComment) return null;
    return <details className={styles.taskComments}><summary>Comentarios ({list.length})</summary>
      {list.map(comment => <p key={comment.id}><strong>{comment.authorName}</strong> · {formatClubDate(comment.createdAt)}<br />{comment.body}</p>)}
      {canComment && <form className={styles.commentForm} onSubmit={event => {
        event.preventDefault();
        const form = event.currentTarget;
        const body = String(new FormData(form).get("body") ?? "");
        run(() => addTaskCommentAction(task.id, body), () => form.reset(), `comment-${task.id}`);
      }}><textarea name="body" required minLength={2} maxLength={2000} placeholder="Avance, duda o necesidad" /><button className={styles.quietButton} disabled={pending}>{savingForm === `comment-${task.id}` ? "Enviando…" : "Comentar"}</button></form>}
    </details>;
  }

  function taskRow(task: PlatformTask, showActivity = false) {
    const canChange = canManageTasksOf(task.activityId) || task.assigneeId === currentUserId;
    const canEdit = canManageTasksOf(task.activityId) && (task.activityId !== null || canManage);
    const activity = showActivity ? activities.find(item => item.id === task.activityId) : null;
    return <div key={task.id}>
      <div className={`${styles.task} ${isOverdue(task) ? styles.taskOverdue : ""}`}><div>
        <strong>{task.title}</strong>{isOverdue(task) && <span className={styles.overdueBadge}>Vencida</span>}
        <p>{activity ? `${activity.title} · ` : showActivity && task.proposalId ? "Propuesta del club · " : ""}{task.assigneeId ? names.get(task.assigneeId) ?? "Miembro asignado" : "Sin responsable"} · Prioridad {priorities[task.priority as keyof typeof priorities]?.toLowerCase() ?? task.priority}{task.dueAt ? ` · Vence ${dateLabel(task.dueAt)}` : ""}</p>
        {task.description && <p>{task.description}</p>}
      </div><div className={styles.taskButtons}>
        {canChange ? <select aria-label={`Estado de la tarea ${task.title}`} value={task.status} disabled={pending} onChange={event => changeStatus(task, event.target.value as TaskStatus)}>{Object.entries(taskStates).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select> : <span className={styles.badge}>{taskStates[task.status as TaskStatus] ?? task.status}</span>}
        {canEdit && <button type="button" aria-expanded={editingTaskId === task.id} onClick={() => setEditingTaskId(current => current === task.id ? null : task.id)}>{editingTaskId === task.id ? "Cerrar edición" : "Editar tarea"}</button>}
        {canDelete && <button type="button" className={styles.dangerButton} disabled={pending} onClick={() => { if (window.confirm(`¿Eliminar la tarea «${task.title}» y sus comentarios?`)) run(() => deleteTaskAction(task.id)); }}>Eliminar</button>}
      </div></div>
      {editingTaskId === task.id && canEdit && <form className={`${styles.form} ${styles.detail}`} onSubmit={event => saveTask(event, task.activityId, task)}><TaskFields members={members} task={task} /><div className={styles.formButtons}><button className={styles.button} disabled={pending}>{savingForm === `task-${task.id}` ? "Guardando…" : "Guardar tarea"}</button><button type="button" className={styles.quietButton} onClick={() => setEditingTaskId(null)}>Cancelar</button></div></form>}
      {taskComments(task)}
    </div>;
  }

  return <section className={styles.workspace}>
    <div className={styles.heading}><div><h2>Actividades y tareas</h2><p>Organiza la ejecución del trabajo del club: objetivo, responsables, fechas y tareas. Cada actividad puede recibir aportes y gastos desde Finanzas y convocar a los miembros desde la Agenda.</p></div>{canManage && <button type="button" className={styles.button} aria-expanded={creating} onClick={() => setCreating(current => !current)}>+ Crear actividad</button>}</div>
    <div className={styles.viewTabs} role="group" aria-label="Vista">
      <button type="button" aria-pressed={view === "activities"} onClick={() => setView("activities")}>Actividades</button>
      <button type="button" aria-pressed={view === "mine"} onClick={() => setView("mine")}>Mis tareas <span>{myTasks.length}</span></button>
    </div>
    {pending ? <p className={styles.muted} role="status">Actualizando…</p>
      : feedback && <p className={`${styles.feedback} ${feedback.ok ? "" : styles.error}`} role={feedback.ok ? "status" : "alert"}>{feedback.message}</p>}
    {loading && !workspace && <p className={styles.muted} role="status">Cargando la lista completa de actividades y tareas…</p>}
    {loadError && <div className={`${styles.feedback} ${styles.error}`} role="alert">{loadError} <button type="button" className={styles.quietButton} disabled={loading} onClick={() => void reloadWorkspace()}>Volver a cargar</button></div>}
    {view === "mine" ? <article className={styles.card}>
      <h3 className={styles.sectionTitle}>Mis tareas abiertas</h3>
      <p className={styles.muted}>Ordenadas por vencimiento. Las vencidas aparecen resaltadas.</p>
      <div className={styles.taskList}>{myTasks.map(task => taskRow(task, true))}</div>
      {myTasks.length === 0 && <p className={styles.empty}>No tienes tareas abiertas.</p>}
    </article> : <>
      {creating && canManage && <article className={`${styles.card} ${styles.newForm}`}><h3 className={styles.sectionTitle}>Nueva actividad</h3><p className={styles.muted}>Se creará como planificada. Después podrás asignar un responsable y añadir tareas.</p>{activityForm()}</article>}
      <div className={styles.filters}><label>Buscar actividad<input type="search" value={query} placeholder="Nombre de la actividad" onChange={event => setQuery(event.target.value)} /></label><label>Estado<select value={filter} onChange={event => setFilter(event.target.value)}><option value="all">Todos</option>{Object.entries(activityStates).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></div>
      <div className={styles.activityGrid}>{visible.map(activity => {
        const linkedTasks = tasks.filter(task => task.activityId === activity.id);
        const counted = linkedTasks.filter(task => task.status !== "cancelled");
        const completed = counted.filter(task => task.status === "done").length;
        const archived = ["completed", "cancelled"].includes(activity.status);
        const manageTasks = canManageTasksOf(activity.id);
        const event = events.find(item => item.activityId === activity.id);
        return <article className={styles.card} key={activity.id}>
          <div className={styles.heading}><div><span className={`${styles.badge} ${activity.status === "active" ? styles.active : ""}`}>{activityStates[activity.status as keyof typeof activityStates] ?? activity.status}</span>{activity.leadId === currentUserId && <span className={styles.badge}>Eres responsable</span>}<h3 style={{ marginTop: 10 }}>{activity.title}</h3></div>
            <div className={styles.taskButtons}>{canManage && <button type="button" className={styles.quietButton} aria-expanded={editingId === activity.id} onClick={() => setEditingId(current => current === activity.id ? null : activity.id)}>{editingId === activity.id ? "Cerrar" : "Editar"}</button>}
              {canDelete && <button type="button" className={styles.dangerButton} disabled={pending} onClick={() => { if (window.confirm(`¿Eliminar «${activity.title}» con sus ${linkedTasks.length} tareas? Sus movimientos en Finanzas se conservan.`)) run(() => deleteActivityAction(activity.id)); }}>Eliminar</button>}</div></div>
          {editingId === activity.id ? activityForm(activity) : <><p className={styles.description}>{activity.description ?? "Añade el objetivo y los detalles de esta actividad."}</p><div className={styles.activityMeta}><span>Inicio: {dateLabel(activity.startsAt)}</span>{activity.endsAt && <span>Cierre: {dateLabel(activity.endsAt)}</span>}<span>{activity.location ?? "Lugar por definir"}</span><span>Responsable: {activity.leadId ? names.get(activity.leadId) ?? "Miembro asignado" : "Sin asignar"}</span>
            {event ? <span>Evento en la Agenda: {eventStates[event.status] ?? event.status}</span> : canManage && !archived && <button type="button" className={styles.quietButton} disabled={pending || !activity.startsAt} title={activity.startsAt ? undefined : "Define la fecha de inicio para crear el evento"} onClick={() => run(() => createEventFromActivityAction(activity.id))}>Crear evento en la Agenda</button>}</div></>}
          <div className={styles.taskHeading}><h4>Tareas · {completed}/{counted.length} terminadas{linkedTasks.length > counted.length ? ` · ${linkedTasks.length - counted.length} canceladas` : ""}</h4>{manageTasks && !archived && <button type="button" className={styles.quietButton} aria-expanded={taskFormId === activity.id} onClick={() => setTaskFormId(current => current === activity.id ? null : activity.id)}>+ Añadir tarea</button>}</div>
          {taskFormId === activity.id && !archived && <form className={styles.form} onSubmit={event => saveTask(event, activity.id)}><TaskFields members={members} /><div className={styles.formButtons}><button className={styles.button} disabled={pending}>{savingForm === `task-new-${activity.id}` ? "Guardando…" : "Crear tarea"}</button><button type="button" className={styles.quietButton} onClick={() => setTaskFormId(null)}>Cancelar</button></div></form>}
          <div className={styles.taskList}>{linkedTasks.map(task => taskRow(task))}</div>{linkedTasks.length === 0 && <p className={styles.empty}>{archived ? "Esta actividad no tiene tareas registradas." : "Añade tareas para distribuir el trabajo y darle seguimiento."}</p>}
        </article>;
      })}</div>
      {visible.length === 0 && <p className={styles.empty}>{activities.length ? "No hay actividades con estos filtros." : canManage ? "Crea la primera actividad para asignar responsabilidades y vincular sus aportes y gastos." : "Las actividades aparecerán cuando coordinación las registre."}</p>}
      {tasks.some(task => !task.activityId) && <article className={styles.card}><h3 className={styles.sectionTitle}>Tareas de propuestas</h3><p className={styles.muted}>Compromisos vinculados a propuestas aprobadas del club.</p><div className={styles.taskList}>{tasks.filter(task => !task.activityId).map(task => taskRow(task))}</div></article>}
    </>}
  </section>;
}
