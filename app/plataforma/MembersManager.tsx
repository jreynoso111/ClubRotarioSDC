"use client";

import { useCallback, useEffect, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { PlatformCommittee, PlatformRole, PlatformTask } from "@/lib/platform";
import type { LeadershipPosition } from "@/lib/organization";
import type { PlatformActionResult } from "./actions";
import { listManagedMembersAction, updateMemberAccessAction, updateMemberProfileAction, type ManagedMember } from "./members-actions";
import styles from "./management.module.css";

const roleLabels: Record<PlatformRole, string> = { member: "Miembro", coordinator: "Coordinación", editor: "Edición de la web", club_manager: "Gestión del club", admin: "Administración" };
const statusLabels = { active: "Activo", pending: "Pendiente", suspended: "Suspendido" };
function formatDate(value: string | null) {
  return value ? new Intl.DateTimeFormat("es-DO", { dateStyle: "medium", timeZone: "America/Santo_Domingo" }).format(new Date(value)) : "Aún sin registrar";
}

export function MembersManager({ currentUserId, committees, tasks, initialMemberId = "", leadershipPositions = [], leadershipYear = "", onAssignPosition }: {
  currentUserId: string; committees: PlatformCommittee[]; tasks: PlatformTask[]; initialMemberId?: string; leadershipPositions?: LeadershipPosition[];
  leadershipYear?: string; onAssignPosition?: (userId: string) => void;
}) {
  const router = useRouter();
  const [members, setMembers] = useState<ManagedMember[]>([]);
  const [actorRole, setActorRole] = useState<PlatformRole>("member");
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(initialMemberId);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [feedback, setFeedback] = useState<PlatformActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  const load = useCallback(async () => {
    try {
      const result = await listManagedMembersAction();
      if (!result.ok) { setFeedback(result); return; }
      setMembers(result.members ?? []);
      setActorRole(result.actorRole ?? "member");
      setSelectedId(current => current || result.members?.[0]?.userId || "");
    } catch { setFeedback({ ok: false, message: "No se pudo cargar el directorio de miembros." }); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    let active = true;
    void listManagedMembersAction().then(result => {
      if (!active) return;
      if (!result.ok) { setFeedback(result); return; }
      setMembers(result.members ?? []);
      setActorRole(result.actorRole ?? "member");
      setSelectedId(current => current || initialMemberId || result.members?.[0]?.userId || "");
    }).catch(() => { if (active) setFeedback({ ok: false, message: "No se pudo cargar el directorio de miembros." }); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [initialMemberId]);

  const selected = members.find(member => member.userId === selectedId);
  const visible = members.filter(member => (filter === "all" || member.status === filter) && member.name.toLocaleLowerCase("es").includes(query.toLocaleLowerCase("es")));
  const selectedCommittees = committees.filter(committee => committee.members.some(member => member.userId === selectedId));
  const selectedTasks = tasks.filter(task => task.assigneeId === selectedId);
  const selectedPositions = leadershipPositions.filter(position => position.memberId === selectedId && position.active);
  const canEditAccess = selected && selected.userId !== currentUserId && (actorRole === "admin" || selected.role !== "admin");

  function run(action: () => Promise<PlatformActionResult>) {
    startTransition(async () => {
      try {
        const result = await action();
        setFeedback(result);
        if (result.ok) { await load(); router.refresh(); }
      } catch { setFeedback({ ok: false, message: "No se pudo guardar el cambio. Inténtalo de nuevo." }); }
    });
  }

  function saveAccess(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const data = new FormData(event.currentTarget);
    run(() => updateMemberAccessAction({ userId: selected.userId, role: String(data.get("role")) as PlatformRole, status: String(data.get("status")) as ManagedMember["status"], notes: String(data.get("notes") ?? "") }));
  }
  function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const data = new FormData(event.currentTarget);
    run(() => updateMemberProfileAction({ userId: selected.userId, name: String(data.get("name") ?? ""), bio: String(data.get("bio") ?? "") }));
  }

  return <section className={styles.workspace}>
    <div className={styles.heading}><div><h2>Miembros del club</h2><p>Consulta cada ficha, sus responsabilidades y su acceso a la plataforma. Las personas que crean una cuenta aparecen aquí para aprobar su membresía.</p></div><button type="button" className={styles.quietButton} disabled={pending || loading} onClick={() => { setLoading(true); void load(); }}>Actualizar lista</button></div>
    <div className={styles.summary}>{(["active", "pending", "suspended"] as const).map(status => <span key={status}><strong>{members.filter(member => member.status === status).length}</strong>{statusLabels[status]}s</span>)}</div>
    {feedback && <p className={`${styles.feedback} ${feedback.ok ? "" : styles.error}`} role={feedback.ok ? "status" : "alert"}>{feedback.message}</p>}
    {loading && members.length === 0 ? <p className={styles.empty}>Cargando miembros…</p> : <div className={styles.split}>
      <article className={styles.card}>
        <div className={styles.filters}><label>Buscar miembro<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Nombre del miembro" /></label><label>Estado<select value={filter} onChange={event => setFilter(event.target.value)}><option value="all">Todos</option>{Object.entries(statusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></div>
        <div className={styles.memberList}>{visible.map(member => <button type="button" key={member.userId} className={`${styles.member} ${selectedId === member.userId ? styles.memberSelected : ""}`} onClick={() => setSelectedId(member.userId)} aria-pressed={selectedId === member.userId}><span className={styles.avatar}>{member.name.split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase()}</span><span className={styles.memberText}><strong>{member.name}{member.userId === currentUserId ? " · Tú" : ""}</strong><small>{leadershipPositions.filter(position => position.memberId === member.userId && position.active).map(position => position.title).join(" · ") || "Miembro del club"}</small></span><span className={`${styles.badge} ${styles[member.status]}`}>{statusLabels[member.status]}</span></button>)}</div>
        {visible.length === 0 && <p className={styles.empty}>{members.length === 0 ? "Cuando una persona cree su cuenta, podrás aprobarla y completar su ficha aquí." : "No hay miembros con estos filtros."}</p>}
      </article>
      {selected ? <article className={styles.card} key={`${selected.userId}-${selected.updatedAt}-${selected.name}`}>
        <div className={styles.heading}><div><h3>{selected.name}</h3><p>{roleLabels[selected.role]} · {statusLabels[selected.status]}</p></div></div>
        <dl className={styles.facts}><div><dt>Cuenta registrada</dt><dd>{formatDate(selected.createdAt)}</dd></div><div><dt>Ingreso al club</dt><dd>{formatDate(selected.joinedAt)}</dd></div><div><dt>Aprobación de membresía</dt><dd>{formatDate(selected.approvedAt)}</dd></div><div><dt>Último cambio de acceso</dt><dd>{formatDate(selected.updatedAt)}</dd></div></dl>
        <h4 className={styles.sectionTitle}>Cargos rotarios{leadershipYear ? ` · ${leadershipYear}` : ""}</h4>{selectedPositions.length ? <ul className={styles.list}>{selectedPositions.map(position => <li key={position.id}><strong>{position.title}</strong>{position.responsibilities ? <p className={styles.muted}>{position.responsibilities}</p> : null}</li>)}</ul> : <p className={styles.muted}>Sin cargos asignados en este período.</p>}{onAssignPosition && selected.status === "active" && <button type="button" className={styles.quietButton} onClick={() => onAssignPosition(selected.userId)}>Asignar cargo en el organigrama →</button>}
        <details className={styles.detail}><summary>Editar nombre y perfil</summary><form className={styles.form} onSubmit={saveProfile}><label>Nombre completo<input name="name" defaultValue={selected.name} required minLength={2} maxLength={120} /></label><label>Perfil y ocupación<textarea name="bio" defaultValue={selected.bio ?? ""} maxLength={4000} placeholder="Ocupación, intereses y experiencia del miembro" /></label><button className={styles.button} disabled={pending}>Guardar ficha</button></form></details>
        <details className={styles.detail}><summary>Acceso y notas de la membresía</summary>{canEditAccess ? <form className={styles.form} onSubmit={saveAccess}><div className={styles.twoColumns}><label>Estado<select name="status" defaultValue={selected.status}>{Object.entries(statusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label>Rol en la plataforma<select name="role" defaultValue={selected.role}>{Object.entries(roleLabels).map(([key, label]) => <option key={key} value={key} disabled={actorRole !== "admin" && (key === "admin" || key === "club_manager" && selected.role !== "club_manager")}>{label}</option>)}</select></label></div><p className={styles.muted}>Coordinación organiza actividades; edición gestiona la web y revista; gestión administra miembros y finanzas; administración controla todos los módulos.</p><label>Notas internas<textarea name="notes" defaultValue={selected.notes ?? ""} maxLength={4000} placeholder="Acuerdos o seguimiento de esta membresía" /></label><p className={styles.muted}>Suspender restringe el acceso y conserva la ficha y sus registros. Reactivar mantiene la fecha original de ingreso.</p><button className={styles.button} disabled={pending}>Guardar acceso y notas</button></form> : <p className={styles.empty}>{selected.userId === currentUserId ? "Otro administrador debe modificar el acceso de tu propia cuenta." : "Solo un administrador puede cambiar el acceso de esta cuenta."}</p>}</details>
        <h4 className={styles.sectionTitle}>Comités y responsabilidades</h4>{selectedCommittees.length ? <ul className={styles.list}>{selectedCommittees.map(committee => <li key={committee.id}>{committee.name}{committee.isActive ? "" : " · Terminado"}</li>)}</ul> : <p className={styles.muted}>Aún sin comités asignados. Puedes añadirlo desde Comités.</p>}
        <h4 className={styles.sectionTitle}>Tareas asignadas</h4>{selectedTasks.length ? <ul className={styles.list}>{selectedTasks.map(task => <li key={task.id}>{task.title} · {["done", "cancelled"].includes(task.status) ? "Cerrada" : "En seguimiento"}</li>)}</ul> : <p className={styles.muted}>Aún no tiene tareas asignadas. Puedes crear una en Actividades.</p>}
      </article> : <article className={styles.card}><p className={styles.empty}>Selecciona un miembro para consultar su ficha.</p></article>}
    </div>}
  </section>;
}
