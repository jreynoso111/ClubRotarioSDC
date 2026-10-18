"use client";

import { useCallback, useEffect, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { PlatformCommittee, PlatformRole, PlatformTask } from "@/lib/platform";
import type { LeadershipPosition } from "@/lib/organization";
import { formatClubDate } from "@/lib/club-date";
import {
  accessChangeNeedsConfirmation, accessChangeNeedsReason, actorCanModifyAccount, assignableRoles, memberNotesMaxLength,
  memberReasonRange, memberStatusLabels, memberStatuses, normalizeSearchText, platformRoleLabels, type MemberStatus,
} from "@/lib/member-access";
import { membershipApplicationStatusLabels } from "@/lib/membership-applications";
import type { PlatformActionResult } from "./actions";
import {
  getMemberAccessHistoryAction, listManagedMembersAction, listPendingMembersAction, rejectPendingMemberAction,
  updateMemberAccessAction, updateMemberProfileAction, type ManagedMember, type MemberAccessHistoryEntry, type PendingMember,
} from "./members-actions";
import styles from "./management.module.css";

type AccessInput = Parameters<typeof updateMemberAccessAction>[0];
type AccessState = { role: PlatformRole; status: MemberStatus };
type HistoryResult = PlatformActionResult & { history?: MemberAccessHistoryEntry[] };
type Directory = { result: Awaited<ReturnType<typeof listManagedMembersAction>>; pendingResult: Awaited<ReturnType<typeof listPendingMembersAction>> };

// Both lists load together: the pending section is management-only and fails alone without hiding the directory.
async function fetchDirectory(): Promise<Directory> {
  const [result, pendingResult] = await Promise.all([listManagedMembersAction(), listPendingMembersAction()]);
  return { result, pendingResult };
}

function formatDate(value: string | null) {
  return value ? formatClubDate(value, false) : "Aún sin registrar";
}

// Shown before a suspension or a lower role is saved, so an accidental click cannot change access.
function confirmationText(member: ManagedMember, next: AccessState) {
  const messages: string[] = [];
  if (next.status === "suspended" && member.status !== "suspended") {
    messages.push(`¿Suspender a ${member.name}? Perderá el acceso a la plataforma hasta que se reactive. Se enviará un correo con el motivo.`);
  }
  if (next.role !== member.role && accessChangeNeedsConfirmation(member, { role: next.role, status: "active" })) {
    messages.push(`¿Reducir el rol de ${member.name} a ${platformRoleLabels[next.role]}? Podría perder permisos de su rol actual.`);
  }
  return messages.join("\n\n");
}

export function MembersManager({ currentUserId, committees, tasks, initialMemberId = "", leadershipPositions = [], leadershipYear = "", onAssignPosition, onOpenApplications, onMembersChanged }: {
  currentUserId: string; committees: PlatformCommittee[]; tasks: PlatformTask[]; initialMemberId?: string; leadershipPositions?: LeadershipPosition[];
  leadershipYear?: string; onAssignPosition?: (userId: string) => void; onOpenApplications?: () => void; onMembersChanged?: () => void;
}) {
  const router = useRouter();
  const [members, setMembers] = useState<ManagedMember[]>([]);
  const [pendingMembers, setPendingMembers] = useState<PendingMember[]>([]);
  const [pendingError, setPendingError] = useState("");
  const [actorRole, setActorRole] = useState<PlatformRole>("member");
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(initialMemberId);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | MemberStatus>("all");
  // One banner for every result: a saved change can remount the member card, which would hide a message kept inside it.
  const [feedback, setFeedback] = useState<PlatformActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  const applyDirectory = useCallback(({ result, pendingResult }: Directory) => {
    if (!result.ok) { setFeedback(result); return; }
    setMembers(result.members ?? []);
    setActorRole(result.actorRole ?? "member");
    setSelectedId(current => current || initialMemberId || result.members?.[0]?.userId || "");
    setPendingMembers(pendingResult.ok ? pendingResult.members ?? [] : []);
    setPendingError(pendingResult.ok ? "" : pendingResult.message);
  }, [initialMemberId]);

  const loadDirectory = useCallback(() => fetchDirectory()
    .then(applyDirectory)
    .catch(() => setFeedback({ ok: false, message: "No se pudo cargar el directorio de miembros." }))
    .finally(() => setLoading(false)), [applyDirectory]);

  useEffect(() => {
    let active = true;
    void fetchDirectory()
      .then(directory => { if (active) applyDirectory(directory); })
      .catch(() => { if (active) setFeedback({ ok: false, message: "No se pudo cargar el directorio de miembros." }); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [applyDirectory]);

  const selected = members.find(member => member.userId === selectedId);
  const isManagement = actorRole === "club_manager" || actorRole === "admin";
  const search = normalizeSearchText(query.trim());
  const visible = members.filter(member => (filter === "all" || member.status === filter)
    && (!search || [member.name, platformRoleLabels[member.role], memberStatusLabels[member.status]].some(text => normalizeSearchText(text).includes(search))));
  const selectedCommittees = committees.filter(committee => committee.members.some(member => member.userId === selectedId));
  const selectedTasks = tasks.filter(task => task.assigneeId === selectedId);
  const selectedPositions = leadershipPositions.filter(position => position.memberId === selectedId && position.active);
  const isSelf = selected?.userId === currentUserId;
  const targetAllowed = selected ? actorCanModifyAccount(actorRole, selected.role) : false;
  const canEditAccess = Boolean(selected) && !isSelf && targetAllowed;
  const canEditProfile = Boolean(selected) && (isSelf || targetAllowed);

  // Every change reloads the list, including a conflict, so the screen shows what another person saved.
  function run(action: () => Promise<PlatformActionResult>) {
    startTransition(async () => {
      try {
        const result = await action();
        setFeedback(result);
        if (result.ok || result.code === "conflict") {
          await loadDirectory();
          onMembersChanged?.();
          router.refresh();
        }
      } catch {
        setFeedback({ ok: false, message: "No se pudo guardar el cambio. Inténtalo de nuevo." });
      }
    });
  }

  function saveAccess(input: AccessInput) {
    run(() => updateMemberAccessAction(input));
  }

  function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const data = new FormData(event.currentTarget);
    run(() => updateMemberProfileAction({ userId: selected.userId, name: String(data.get("name") ?? ""), bio: String(data.get("bio") ?? "") }));
  }

  function approve(candidate: PendingMember) {
    // Approval uses the member row's timestamp, so a change made by someone else is detected.
    const record = members.find(member => member.userId === candidate.userId);
    if (!record) {
      setFeedback({ ok: false, message: "La cuenta cambió. Actualiza la lista antes de aprobarla.", code: "conflict" });
      return;
    }
    if (!window.confirm(`¿Aprobar a ${candidate.name} como miembro activo?`)) return;
    run(() => updateMemberAccessAction({ userId: candidate.userId, status: "active", role: "member", notes: record.notes ?? "", expectedUpdatedAt: record.updatedAt }));
  }

  return <section className={styles.workspace}>
    <div className={styles.heading}><div><h2>Miembros del club</h2><p>Consulta cada ficha, sus responsabilidades y su acceso a la plataforma. Las personas que crean una cuenta aparecen arriba para aprobarlas o rechazarlas.</p></div><button type="button" className={styles.quietButton} disabled={pending || loading} onClick={() => { setLoading(true); void loadDirectory(); }}>Actualizar lista</button></div>
    <div className={styles.summary}>{memberStatuses.map(status => <span key={status}><strong>{members.filter(member => member.status === status).length}</strong>{memberStatusLabels[status]}s</span>)}</div>
    {feedback ? <p className={`${styles.feedback} ${feedback.ok ? "" : styles.error}`} role={feedback.ok ? "status" : "alert"}>{feedback.message}</p> : null}

    {isManagement ? <article className={styles.card}>
      <div className={styles.heading}><div><h3>Pendientes de aprobar</h3><p>Cuentas creadas que todavía no son miembros activos. Aprobar les da acceso como miembro; rechazar elimina la cuenta y conserva un registro del rechazo.</p></div></div>
      {pendingError ? <p className={`${styles.feedback} ${styles.error}`} role="alert">{pendingError}</p> : null}
      {!pendingError && pendingMembers.length === 0 ? <p className={styles.empty}>No hay cuentas pendientes de aprobación.</p> : null}
      <div className={styles.pendingList}>{pendingMembers.map(member => <PendingMemberRow key={member.userId} member={member} busy={pending}
        onApprove={() => approve(member)} onReject={reason => run(() => rejectPendingMemberAction(member.userId, reason))} onOpenApplications={onOpenApplications} />)}</div>
    </article> : null}

    {loading && members.length === 0 ? <p className={styles.empty}>Cargando miembros…</p> : <div className={styles.split}>
      <article className={styles.card}>
        <div className={styles.filters}>
          <label>Buscar miembro<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Nombre, rol o estado" /></label>
          <label>Estado<select value={filter} onChange={event => setFilter(event.target.value as "all" | MemberStatus)}><option value="all">Todos</option>{memberStatuses.map(key => <option key={key} value={key}>{memberStatusLabels[key]}</option>)}</select></label>
        </div>
        <div className={styles.memberList}>{visible.map(member => <button type="button" key={member.userId} className={`${styles.member} ${selectedId === member.userId ? styles.memberSelected : ""}`} onClick={() => setSelectedId(member.userId)} aria-pressed={selectedId === member.userId}><span className={styles.avatar}>{member.name.split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase()}</span><span className={styles.memberText}><strong>{member.name}{member.userId === currentUserId ? " · Tú" : ""}</strong><small>{leadershipPositions.filter(position => position.memberId === member.userId && position.active).map(position => position.title).join(" · ") || "Miembro del club"}</small></span><span className={`${styles.badge} ${styles[member.status]}`}>{memberStatusLabels[member.status]}</span></button>)}</div>
        {visible.length === 0 && <p className={styles.empty}>{members.length === 0 ? "Cuando una persona cree su cuenta, aparecerá en Pendientes de aprobar." : "No hay miembros con estos filtros."}</p>}
      </article>
      {selected ? <article className={styles.card} key={`${selected.userId}-${selected.updatedAt}-${selected.name}`}>
        <div className={styles.heading}><div><h3>{selected.name}</h3><p>{platformRoleLabels[selected.role]} · {memberStatusLabels[selected.status]}</p></div></div>
        <dl className={styles.facts}><div><dt>Cuenta registrada</dt><dd>{formatDate(selected.createdAt)}</dd></div><div><dt>Ingreso al club</dt><dd>{formatDate(selected.joinedAt)}</dd></div><div><dt>Aprobación de membresía</dt><dd>{formatDate(selected.approvedAt)}</dd></div><div><dt>Último cambio de acceso</dt><dd>{formatDate(selected.updatedAt)}</dd></div></dl>
        <h4 className={styles.sectionTitle}>Cargos rotarios{leadershipYear ? ` · ${leadershipYear}` : ""}</h4>{selectedPositions.length ? <ul className={styles.list}>{selectedPositions.map(position => <li key={position.id}><strong>{position.title}</strong>{position.responsibilities ? <p className={styles.muted}>{position.responsibilities}</p> : null}</li>)}</ul> : <p className={styles.muted}>Sin cargos asignados en este período.</p>}{onAssignPosition && selected.status === "active" && <button type="button" className={styles.quietButton} onClick={() => onAssignPosition(selected.userId)}>Asignar cargo en el organigrama →</button>}
        <details className={styles.detail}><summary>Editar nombre y perfil</summary>{canEditProfile ? <form className={styles.form} onSubmit={saveProfile}><label>Nombre completo<input name="name" defaultValue={selected.name} required minLength={2} maxLength={120} /></label><label>Perfil y ocupación<textarea name="bio" defaultValue={selected.bio ?? ""} maxLength={4000} placeholder="Ocupación, intereses y experiencia del miembro" /></label><button className={styles.button} disabled={pending}>Guardar ficha</button></form> : <p className={styles.empty}>Solo un administrador puede modificar esta cuenta.</p>}</details>
        <details className={styles.detail}><summary>Acceso y notas de la membresía</summary>{canEditAccess ? <AccessForm member={selected} actorRole={actorRole} busy={pending} onSave={saveAccess} /> : <p className={styles.empty}>{isSelf ? "Otro administrador debe modificar el acceso de tu propia cuenta." : "Solo un administrador puede modificar esta cuenta."}</p>}</details>
        <AccessHistoryDetails userId={selected.userId} />
        <h4 className={styles.sectionTitle}>Comités y responsabilidades</h4>{selectedCommittees.length ? <ul className={styles.list}>{selectedCommittees.map(committee => <li key={committee.id}>{committee.name}{committee.isActive ? "" : " · Terminado"}</li>)}</ul> : <p className={styles.muted}>Aún sin comités asignados. Puedes añadirlo desde Comités.</p>}
        <h4 className={styles.sectionTitle}>Tareas asignadas</h4>{selectedTasks.length ? <ul className={styles.list}>{selectedTasks.map(task => <li key={task.id}>{task.title} · {["done", "cancelled"].includes(task.status) ? "Cerrada" : "En seguimiento"}</li>)}</ul> : <p className={styles.muted}>Aún no tiene tareas asignadas. Puedes crear una en Actividades.</p>}
      </article> : <article className={styles.card}><p className={styles.empty}>Selecciona un miembro para consultar su ficha.</p></article>}
    </div>}
  </section>;
}

function AccessForm({ member, actorRole, busy, onSave }: {
  member: ManagedMember; actorRole: PlatformRole; busy: boolean; onSave: (input: AccessInput) => void;
}) {
  const [status, setStatus] = useState<MemberStatus>(member.status);
  const [role, setRole] = useState<PlatformRole>(member.role);
  const [notes, setNotes] = useState(member.notes ?? "");
  const [reason, setReason] = useState("");
  const [localError, setLocalError] = useState("");
  const next: AccessState = { role, status };
  const needsReason = accessChangeNeedsReason(member, next);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = reason.trim();
    if (needsReason && (text.length < memberReasonRange.min || text.length > memberReasonRange.max)) {
      setLocalError(`Escribe el motivo (${memberReasonRange.min} a ${memberReasonRange.max} caracteres).`);
      return;
    }
    const confirmation = confirmationText(member, next);
    if (confirmation && !window.confirm(confirmation)) return;
    setLocalError("");
    onSave({ userId: member.userId, status, role, notes, reason: needsReason ? text : undefined, expectedUpdatedAt: member.updatedAt });
  }

  return <form className={styles.form} onSubmit={submit}>
    <div className={styles.twoColumns}>
      <label>Estado<select value={status} disabled={busy} onChange={event => { setStatus(event.target.value as MemberStatus); setLocalError(""); }}>{memberStatuses.map(key => <option key={key} value={key}>{memberStatusLabels[key]}</option>)}</select></label>
      <label>Rol en la plataforma<select value={role} disabled={busy} onChange={event => { setRole(event.target.value as PlatformRole); setLocalError(""); }}>{assignableRoles(actorRole).map(key => <option key={key} value={key}>{platformRoleLabels[key]}</option>)}</select></label>
    </div>
    <p className={styles.muted}>Coordinación organiza actividades; edición gestiona la web y revista; gestión administra miembros y finanzas; administración controla todos los módulos.</p>
    {needsReason ? <label>Motivo<textarea name="reason" value={reason} disabled={busy} required minLength={memberReasonRange.min} maxLength={memberReasonRange.max}
      placeholder="Explica el cambio de acceso" onChange={event => { setReason(event.target.value); setLocalError(""); }} />
      <span className={styles.muted}>Obligatorio para suspender o cambiar el rol. Queda en el historial de acceso{status === "suspended" ? " y se incluye en el correo al miembro" : ""}.</span></label> : null}
    <label>Notas internas<textarea name="notes" value={notes} disabled={busy} maxLength={memberNotesMaxLength} placeholder="Acuerdos o seguimiento de esta membresía" onChange={event => setNotes(event.target.value)} /></label>
    <p className={styles.muted}>Suspender restringe el acceso y conserva la ficha y sus registros. Reactivar mantiene la fecha original de ingreso.</p>
    {localError ? <p className={`${styles.feedback} ${styles.error}`} role="alert">{localError}</p> : null}
    <button className={styles.button} disabled={busy}>Guardar acceso y notas</button>
  </form>;
}

function PendingMemberRow({ member, busy, onApprove, onReject, onOpenApplications }: {
  member: PendingMember; busy: boolean; onApprove: () => void; onReject: (reason: string) => void; onOpenApplications?: () => void;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [localError, setLocalError] = useState("");

  function submitRejection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = reason.trim();
    if (text.length < memberReasonRange.min || text.length > memberReasonRange.max) {
      setLocalError(`Escribe el motivo del rechazo (${memberReasonRange.min} a ${memberReasonRange.max} caracteres).`);
      return;
    }
    if (!window.confirm(`Se eliminará la cuenta; quedará un registro del rechazo. ¿Rechazar la solicitud de ${member.name}?`)) return;
    setLocalError("");
    onReject(text);
  }

  return <article className={styles.pendingRow}>
    <div className={styles.pendingText}>
      <strong>{member.name}</strong>
      <span>{member.email ?? "Sin correo registrado"} · <span className={member.emailConfirmed ? styles.confirmed : styles.unconfirmed}>{member.emailConfirmed ? "Correo confirmado" : "Correo sin confirmar"}</span></span>
      <small>Registrada el {formatDate(member.registeredAt)}</small>
      {member.applicationId ? <small>Solicitud: {member.applicationFullName?.trim() || "Sin nombre"}{member.applicationStatus ? ` · ${membershipApplicationStatusLabels[member.applicationStatus]}` : ""}
        {onOpenApplications ? <> · <button type="button" className={styles.linkButton} onClick={onOpenApplications}>Ver en Solicitudes</button></> : null}</small>
        : <small>Sin solicitud vinculada.</small>}
    </div>
    {rejecting ? <form className={styles.form} onSubmit={submitRejection}>
      <label>Motivo del rechazo<textarea value={reason} disabled={busy} required minLength={memberReasonRange.min} maxLength={memberReasonRange.max}
        placeholder="Explica por qué no se aprueba la cuenta" onChange={event => { setReason(event.target.value); setLocalError(""); }} /></label>
      <p className={styles.muted}>Se eliminará la cuenta; quedará un registro del rechazo.</p>
      {localError ? <p className={`${styles.feedback} ${styles.error}`} role="alert">{localError}</p> : null}
      <div className={styles.formButtons}>
        <button type="submit" className={styles.dangerButton} disabled={busy}>Confirmar rechazo</button>
        <button type="button" className={styles.quietButton} disabled={busy} onClick={() => { setRejecting(false); setLocalError(""); }}>Cancelar</button>
      </div>
    </form> : <div className={styles.formButtons}>
      <button type="button" className={styles.button} disabled={busy} onClick={onApprove}>Aprobar</button>
      <button type="button" className={styles.dangerButton} disabled={busy} onClick={() => setRejecting(true)}>Rechazar</button>
    </div>}
  </article>;
}

// The history is requested the first time the panel opens, so the list does not load for every card.
function AccessHistoryDetails({ userId }: { userId: string }) {
  const [opened, setOpened] = useState(false);
  return <details className={styles.detail} onToggle={event => { if (event.currentTarget.open) setOpened(true); }}>
    <summary>Historial de acceso</summary>
    {opened ? <AccessHistory userId={userId} /> : null}
  </details>;
}

function AccessHistory({ userId }: { userId: string }) {
  const [result, setResult] = useState<HistoryResult | null>(null);

  useEffect(() => {
    let active = true;
    getMemberAccessHistoryAction(userId)
      .then(response => { if (active) setResult(response); })
      .catch(() => { if (active) setResult({ ok: false, message: "No se pudo cargar el historial de acceso." }); });
    return () => { active = false; };
  }, [userId]);

  if (!result) return <p className={styles.empty} role="status">Cargando historial…</p>;
  if (!result.ok) return <p className={`${styles.feedback} ${styles.error}`} role="alert">{result.message}</p>;
  const entries = result.history ?? [];
  if (entries.length === 0) return <p className={styles.empty}>Todavía no hay cambios de acceso registrados.</p>;
  return <ol className={styles.historyList}>{entries.map((entry, index) => {
    const changes = [
      entry.fromRole !== entry.toRole ? `Rol: ${entry.fromRole ? platformRoleLabels[entry.fromRole] : "Sin rol previo"} → ${platformRoleLabels[entry.toRole]}` : null,
      entry.fromStatus !== entry.toStatus ? `Estado: ${entry.fromStatus ? memberStatusLabels[entry.fromStatus] : "Sin estado previo"} → ${memberStatusLabels[entry.toStatus]}` : null,
    ].filter(Boolean);
    return <li key={`${entry.createdAt}-${index}`}>
      <strong>{changes.join(" · ") || "Cambio de ficha"}</strong>
      <span>{formatClubDate(entry.createdAt)} · {entry.actorName}</span>
      {entry.reason ? <span className={styles.historyReason}>{entry.reason}</span> : null}
    </li>;
  })}</ol>;
}
