"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import type { FormEvent } from "react";

import type { PlatformCommittee, PlatformDirectoryMember } from "@/lib/platform";

import {
  assignCommitteeMemberAction,
  completeCommitteeAction,
  createCommitteeAction,
  removeCommitteeMemberAction,
  updateCommitteeAction,
  type PlatformActionResult,
} from "./actions";
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

  function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const userIds = data.getAll("initialMemberUserId");
    const roles = data.getAll("initialMemberRole");
    const members = userIds.map((userId, index) => ({
      userId: String(userId),
      committeeRole: String(roles[index] ?? "member") as CommitteeRole,
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

  function handleAssign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    run(() => assignCommitteeMemberAction({
      committeeId: String(data.get("committeeId") ?? ""),
      userId: String(data.get("userId") ?? ""),
      committeeRole: String(data.get("committeeRole") ?? "member") as CommitteeRole,
    }), () => form.reset());
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
            {canManage && committee.isActive ? (
              <div className={styles.committeeActions}>
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
                <form onSubmit={handleAssign}>
                  <input type="hidden" name="committeeId" value={committee.id} />
                  <label>Integrante<select name="userId" defaultValue="" required>
                    <option value="" disabled>Selecciona una persona activa</option>
                    {candidates.map((candidate) => <option key={candidate.userId} value={candidate.userId}>{candidate.name}</option>)}
                  </select></label>
                  <label>Responsabilidad<select name="committeeRole" defaultValue="member">
                    {committeeRoles.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select></label>
                  <button type="submit" className={styles.smallButton} disabled={pending}>{pending ? "Guardando…" : "Guardar integrante"}</button>
                </form>
              ) : <p className={styles.empty}>No hay otras membresías activas disponibles.</p>}
            </details>
          ) : null}
        </div>
      ))}
      {committees.length === 0 ? <p className={styles.empty}>Los comités aparecerán aquí cuando el administrador cree la estructura del club.</p> : null}
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
            const selectedElsewhere = new Set(initialMembers.filter((item) => item.id !== member.id).map((item) => item.userId));
            return <div className={styles.committeeInitialRow} key={member.id}>
              <label>Integrante {index + 1}<select name="initialMemberUserId" required value={member.userId}
                onChange={(event) => setInitialMember(member.id, "userId", event.currentTarget.value)}>
                <option value="" disabled>Selecciona una persona activa</option>
                {candidates.map((candidate) => <option key={candidate.userId} value={candidate.userId}
                  disabled={candidate.userId !== member.userId && selectedElsewhere.has(candidate.userId)}>{candidate.name}</option>)}
              </select></label>
              <label>Rol<select name="initialMemberRole" value={member.committeeRole}
                onChange={(event) => setInitialMember(member.id, "committeeRole", event.currentTarget.value)}>
                {committeeRoles.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select></label>
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
      <p className={styles.empty}>Por ahora, solo el administrador puede crear o cambiar los comités.</p>
    </article>}
  </>;
}
