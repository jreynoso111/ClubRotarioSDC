"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState, useTransition } from "react";
import type { FormEvent } from "react";

import type { PlatformCommittee, PlatformDirectoryMember } from "@/lib/platform";
import { chairConflict } from "@/lib/member-picker";

import {
  assignCommitteeMemberAction,
  completeCommitteeAction,
  createCommitteeAction,
  removeCommitteeMemberAction,
  reopenCommitteeAction,
  updateCommitteeAction,
  type PlatformActionResult,
} from "./actions";
import { MemberPicker } from "./MemberPicker";
import styles from "./platform.module.css";

type CommitteeRole = "member" | "chair" | "secretary" | "treasurer";

type InitialMember = {
  id: number;
  userId: string;
  committeeRole: CommitteeRole;
};

const committeeRoleLabels: Record<CommitteeRole, string> = {
  member: "Integrante",
  chair: "Presidencia",
  secretary: "Secretaría",
  treasurer: "Tesorería",
};

const committeeRoles = Object.entries(committeeRoleLabels) as Array<[CommitteeRole, string]>;

// While another person holds the chair, the chair option is disabled and the role falls back to member.
function effectiveRole(role: CommitteeRole, blockedBy: string | null): CommitteeRole {
  return role === "chair" && blockedBy ? "member" : role;
}

function RoleSelect({ value, blockedBy, onChange }: {
  value: CommitteeRole;
  blockedBy: string | null;
  onChange: (role: CommitteeRole) => void;
}) {
  const hintId = useId();
  return (
    <div className={styles.roleField}>
      <label>Responsabilidad
        <select value={value} aria-describedby={blockedBy ? hintId : undefined}
          onChange={(event) => onChange(event.currentTarget.value as CommitteeRole)}>
          {committeeRoles.map(([roleValue, label]) => (
            <option key={roleValue} value={roleValue} disabled={roleValue === "chair" && Boolean(blockedBy)}>{label}</option>
          ))}
        </select>
      </label>
      {blockedBy ? (
        <small id={hintId} className={styles.committeeHint}>
          La presidencia ya la ocupa {blockedBy}. Para cambiarla, primero asigna otra responsabilidad a esa persona.
        </small>
      ) : null}
    </div>
  );
}

function MemberAssignForm({ committee, candidates, pending, onAssign }: {
  committee: PlatformCommittee;
  candidates: PlatformDirectoryMember[];
  pending: boolean;
  onAssign: (userId: string, role: CommitteeRole, reset: () => void) => void;
}) {
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState<CommitteeRole>("member");
  const blockedBy = chairConflict(committee.members, userId)?.name ?? null;

  return (
    <form onSubmit={(event) => {
      event.preventDefault();
      if (!userId) return;
      onAssign(userId, effectiveRole(role, blockedBy), () => {
        setUserId("");
        setRole("member");
      });
    }}>
      <MemberPicker label="Integrante" candidates={candidates} value={userId} emptyLabel="Selecciona una persona activa"
        onChange={setUserId} />
      <RoleSelect value={effectiveRole(role, blockedBy)} blockedBy={blockedBy} onChange={setRole} />
      <button type="submit" className={styles.smallButton} disabled={pending || !userId}>{pending ? "Guardando…" : "Guardar integrante"}</button>
    </form>
  );
}

export function CommitteeManager({
  committees,
  candidates,
  canManage,
}: {
  committees: PlatformCommittee[];
  candidates: PlatformDirectoryMember[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState("");
  const [feedbackError, setFeedbackError] = useState(false);
  const [initialMembers, setInitialMembers] = useState<InitialMember[]>([]);
  const [editingCommitteeId, setEditingCommitteeId] = useState<string | null>(null);
  const nextMemberId = useRef(0);

  function run(action: () => Promise<PlatformActionResult>, onSuccess?: () => void) {
    startTransition(async () => {
      try {
        const result = await action();
        setFeedback(result.message);
        setFeedbackError(!result.ok);
        if (result.ok) {
          onSuccess?.();
          router.refresh();
        }
      } catch {
        setFeedback("No se pudo guardar el cambio. Actualiza la página e inténtalo de nuevo.");
        setFeedbackError(true);
      }
    });
  }

  function nameOf(userId: string) {
    return candidates.find((candidate) => candidate.userId === userId)?.name ?? "otra persona";
  }

  // The chair held by another row of the creation form blocks this row's chair option.
  function blockerFor(member: InitialMember) {
    const others = initialMembers
      .filter((item) => item.id !== member.id && item.userId)
      .map((item) => ({ userId: item.userId, role: item.committeeRole }));
    const holder = chairConflict(others, member.userId);
    return holder ? nameOf(holder.userId) : null;
  }

  function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    if (initialMembers.some((member) => !member.userId)) {
      setFeedback("Selecciona una persona para cada integrante o quita la fila vacía.");
      setFeedbackError(true);
      return;
    }
    const members = initialMembers.map((member) => ({
      userId: member.userId,
      committeeRole: effectiveRole(member.committeeRole, blockerFor(member)),
    }));

    run(() => createCommitteeAction({
      name: String(data.get("name") ?? ""),
      description: String(data.get("description") ?? ""),
      members,
    }), () => {
      form.reset();
      setInitialMembers([]);
    });
  }

  function handleUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const committeeId = String(data.get("committeeId") ?? "");
    run(() => updateCommitteeAction({
      committeeId,
      name: String(data.get("name") ?? ""),
      description: String(data.get("description") ?? ""),
    }), () => setEditingCommitteeId(null));
  }

  function addInitialMember() {
    setInitialMembers((current) => [
      ...current,
      { id: nextMemberId.current++, userId: "", committeeRole: "member" },
    ]);
  }

  function setInitialMember(id: number, field: "userId" | "committeeRole", value: string) {
    setInitialMembers((current) => current.map((member) => member.id === id
      ? { ...member, [field]: value }
      : member));
  }

  return <>
    <article className={`${styles.card} ${styles.cardWide}`}>
      <p className={styles.cardLabel}>Estructura del club</p>
      <h2 className={styles.cardTitle}>Comités, personas y responsabilidades.</h2>
      {committees.map((committee) => (
        <div className={committee.isActive ? styles.committee : `${styles.committee} ${styles.committeeArchived}`} key={committee.id}>
          <div className={styles.committeeHeading}>
            <div className={styles.committeeTitle}>
              <span className={committee.isActive ? styles.committeeActive : styles.committeeCompleted}>
                {committee.isActive ? "Activo" : "Terminado"}
              </span>
              <h3>{committee.name}</h3>
              <p>{committee.description ?? "Sin descripción todavía."}</p>
            </div>
            {canManage ? (
              <div className={styles.committeeActions}>
                {committee.isActive ? (
                  <>
                    <button type="button" className={styles.smallButtonQuiet}
                      aria-expanded={editingCommitteeId === committee.id}
                      aria-controls={`committee-editor-${committee.id}`}
                      onClick={() => setEditingCommitteeId((current) => current === committee.id ? null : committee.id)}>
                      {editingCommitteeId === committee.id ? "Cerrar edición" : "Editar"}
                    </button>
                    <button type="button" className={styles.smallButtonQuiet}
                      disabled={pending}
                      onClick={() => {
                        if (window.confirm(`¿Dar por terminado el comité “${committee.name}”? Se conservarán su lista y su historial.`)) {
                          run(() => completeCommitteeAction(committee.id), () => setEditingCommitteeId(null));
                        }
                      }}>
                      Dar por terminado
                    </button>
                  </>
                ) : (
                  <button type="button" className={styles.smallButtonQuiet} disabled={pending}
                    onClick={() => {
                      if (window.confirm(`¿Reabrir el comité “${committee.name}”? Volverá a estar activo con su lista actual.`)) {
                        run(() => reopenCommitteeAction(committee.id));
                      }
                    }}>
                    Reabrir comité
                  </button>
                )}
              </div>
            ) : null}
          </div>

          {editingCommitteeId === committee.id ? (
            <form id={`committee-editor-${committee.id}`} className={styles.committeeEditor} onSubmit={handleUpdate}>
              <input type="hidden" name="committeeId" value={committee.id} />
              <label>Nombre del comité<input name="name" required minLength={2} maxLength={140} defaultValue={committee.name} /></label>
              <label>Descripción<textarea name="description" maxLength={2000} defaultValue={committee.description ?? ""} /></label>
              <button type="submit" className={styles.smallButton} disabled={pending}>{pending ? "Guardando…" : "Guardar cambios"}</button>
            </form>
          ) : null}

          {committee.members.length > 0 ? (
            <ul className={styles.committeeRoster}>
              {committee.members.map((member) => (
                <li key={member.userId}>
                  <span>{member.name}</span>
                  <small>{committeeRoleLabels[member.role as CommitteeRole] ?? member.role}</small>
                  {canManage && committee.isActive ? (
                    <button type="button" className={styles.committeeRemoveMember} disabled={pending}
                      aria-label={`Quitar a ${member.name} del comité ${committee.name}`}
                      onClick={() => {
                        if (window.confirm(`¿Quitar a ${member.name} del comité?`)) {
                          run(() => removeCommitteeMemberAction({ committeeId: committee.id, userId: member.userId }));
                        }
                      }}>
                      Quitar
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : <p className={styles.empty}>Aún no tiene integrantes asignados.</p>}

          {canManage && committee.isActive ? (
            <details className={styles.committeeRosterEditor}>
              <summary>Añadir integrante o cambiar responsabilidad</summary>
              {candidates.length > 0 ? (
                <MemberAssignForm committee={committee} candidates={candidates} pending={pending}
                  onAssign={(userId, role, reset) => run(() => assignCommitteeMemberAction({
                    committeeId: committee.id,
                    userId,
                    committeeRole: role,
                  }), reset)} />
              ) : <p className={styles.empty}>No hay otras membresías activas disponibles.</p>}
            </details>
          ) : null}
        </div>
      ))}
      {committees.length === 0 ? <p className={styles.empty}>Los comités aparecerán aquí cuando administración cree la estructura del club.</p> : null}
      {feedback ? <p className={feedbackError ? styles.feedbackError : styles.feedbackSuccess} role={feedbackError ? "alert" : "status"}>{feedback}</p> : null}
    </article>

    {canManage ? (
      <form className={styles.formCard} onSubmit={handleCreate}>
        <p className={styles.cardLabel}>Administración de comités</p>
        <h2 className={styles.cardTitle}>Crear un comité.</h2>
        <label>Nombre<input name="name" required minLength={2} maxLength={140} placeholder="Ej. Servicio a la comunidad" /></label>
        <label>Descripción<textarea name="description" maxLength={2000} placeholder="Objetivo y alcance del comité" /></label>
        <div className={styles.committeeInitialMembers}>
          <div><strong>Integrantes iniciales</strong><span>Asigna un cargo a cada persona desde la creación.</span></div>
          {initialMembers.map((member, index) => {
            const selectedElsewhere = new Set(initialMembers
              .filter((item) => item.id !== member.id && item.userId)
              .map((item) => item.userId));
            const blockedBy = blockerFor(member);
            return <div className={styles.committeeInitialRow} key={member.id}>
              <MemberPicker label={`Integrante ${index + 1}`} candidates={candidates} value={member.userId}
                emptyLabel="Selecciona una persona activa" disabledIds={selectedElsewhere}
                onChange={(userId) => setInitialMember(member.id, "userId", userId)} />
              <RoleSelect value={effectiveRole(member.committeeRole, blockedBy)} blockedBy={blockedBy}
                onChange={(role) => setInitialMember(member.id, "committeeRole", role)} />
              <button type="button" className={styles.committeeRemoveMember} aria-label={`Quitar integrante ${index + 1}`}
                onClick={() => setInitialMembers((current) => current.filter((item) => item.id !== member.id))}>Quitar</button>
            </div>;
          })}
          <button type="button" className={styles.smallButtonQuiet} disabled={candidates.length === 0 || initialMembers.length >= candidates.length || initialMembers.length >= 50}
            onClick={addInitialMember}>+ Agregar integrante</button>
          {candidates.length === 0 ? <p className={styles.empty}>No hay membresías activas disponibles para asignar.</p> : null}
        </div>
        <button className={styles.button} disabled={pending}>{pending ? "Creando comité…" : "Crear comité"}</button>
      </form>
    ) : <article className={styles.card}>
      <p className={styles.cardLabel}>Administración de comités</p>
      <h2 className={styles.cardTitle}>Una estructura para servir juntos.</h2>
      <p className={styles.empty}>Por ahora, solo administración y la gestión del club pueden crear o cambiar los comités.</p>
    </article>}
  </>;
}
