"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import type { PlatformDirectoryMember, PlatformProposal, PlatformProposalHistoryEntry, PlatformTask, ProposalVoteChoice, ProposalVoteTally } from "@/lib/platform";
import { formatClubDate } from "@/lib/club-date";

import styles from "./platform.module.css";

const voteChoices: Array<{ value: ProposalVoteChoice; label: string; recorded: string }> = [
  { value: "for", label: "A favor", recorded: "A favor" },
  { value: "against", label: "En contra", recorded: "En contra" },
  { value: "abstain", label: "Abstenerme", recorded: "Abstención" },
];
const statusChips: Record<string, string> = {
  draft: "Borrador", submitted: "Enviada", in_review: "En revisión", approved: "Aprobada", rejected: "Devuelta", archived: "Archivada",
};
type ReviewDecision = "in_review" | "approved" | "rejected" | "archived";

const historyLabels: Record<PlatformProposalHistoryEntry["event"], string> = {
  submitted: "Enviada a revisión", in_review: "Puesta en revisión", approved: "Aprobada", rejected: "Devuelta al autor",
  archived: "Archivada", corrected: "Corregida por el autor", voting_opened: "Votación abierta", voting_closed: "Votación cerrada",
  tie_runoff: "Empate: se abrió un desempate",
};
const taskStatusLabels: Record<string, string> = { todo: "Pendiente", in_progress: "En curso", blocked: "Bloqueada", done: "Completada", cancelled: "Cancelada" };

function tallyText(tally: ProposalVoteTally) {
  return `${tally.for} a favor, ${tally.against} en contra, ${tally.abstain} ${tally.abstain === 1 ? "abstención" : "abstenciones"}`;
}

// Explains why the current ballot is not the first one.
function roundNotice(proposal: PlatformProposal) {
  if (proposal.voting.round <= 1) return null;
  const restart = [...proposal.history].reverse().find(entry => entry.event === "corrected" || entry.event === "tie_runoff");
  if (!restart) return `Ronda ${proposal.voting.round} de votación.`;
  const previous = restart.tally ? ` La ronda anterior (${tallyText(restart.tally)})` : " La ronda anterior";
  return restart.event === "tie_runoff"
    ? `Ronda ${proposal.voting.round}: votación de desempate.${previous} terminó en empate; sus votos quedaron en el historial.`
    : `Ronda ${proposal.voting.round}: la propuesta fue corregida por su autor.${previous} quedó archivada y se vota de nuevo sobre la versión actual.`;
}

function notesLabel(status: string) {
  if (status === "rejected") return "Motivo de la devolución";
  if (status === "approved" || status === "archived") return "Notas de la decisión";
  if (status === "submitted") return "Observaciones de la revisión anterior";
  return "Notas de revisión";
}

export function ProposalCard({
  proposal,
  metadata,
  currentUserId,
  canManageVoting,
  pending,
  onSubmit,
  onToggleVoting,
  onVote,
  onEdit,
  onReview,
  onDelete,
  tasks,
  members,
  onCreateTask,
}: {
  proposal: PlatformProposal;
  metadata: string;
  currentUserId: string;
  canManageVoting: boolean;
  pending: boolean;
  onSubmit: () => void;
  onToggleVoting: (enabled: boolean) => void;
  onVote: (choice: ProposalVoteChoice) => void;
  onEdit: (input: {title:string;summary:string;details:string}, onSuccess:()=>void) => void;
  onReview: (input: {status:ReviewDecision;notes:string}) => void;
  onDelete: () => void;
  tasks: PlatformTask[];
  members: PlatformDirectoryMember[];
  onCreateTask: (input: { title: string; assigneeId: string; dueAt: string; priority: "low" | "normal" | "high" | "urgent" }, onSuccess: () => void) => void;
}) {
  const [creatingTask, setCreatingTask] = useState(false);
  function createTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const due = String(data.get("dueAt") ?? "");
    onCreateTask({ title: String(data.get("title") ?? ""), assigneeId: String(data.get("assigneeId") ?? ""),
      dueAt: due ? `${due}-04:00` : "", priority: String(data.get("priority")) as "low" | "normal" | "high" | "urgent" }, () => setCreatingTask(false));
  }
  const names = new Map(members.map(member => [member.userId, member.name]));
  const notice = roundNotice(proposal);
  const [editing,setEditing]=useState(false);
  const [decision,setDecision]=useState<ReviewDecision>(proposal.status === "approved" || proposal.status === "rejected" || proposal.status === "archived" ? proposal.status : "in_review");
  function edit(event:FormEvent<HTMLFormElement>) { event.preventDefault();const data=new FormData(event.currentTarget);onEdit({title:String(data.get("title")),summary:String(data.get("summary")),details:String(data.get("details"))},()=>setEditing(false)); }
  function review(event:FormEvent<HTMLFormElement>) {event.preventDefault();const data=new FormData(event.currentTarget);onReview({status:decision,notes:String(data.get("notes"))});}
  const recordedVote = voteChoices.find((choice) => choice.value === proposal.voting.myVote)?.recorded;
  const canSubmit = proposal.status === "draft" && proposal.createdBy === currentUserId;
  const canCorrect = proposal.status === "rejected" && proposal.createdBy === currentUserId;
  const canVoteOnProposal = proposal.status === "submitted" || proposal.status === "in_review";
  const showBallot = proposal.voting.startedAt !== null;

  return <article className={styles.proposalItem} aria-labelledby={`proposal-${proposal.id}`}>
    <div className={styles.proposalItemHeader}>
      <div className={styles.proposalMain}>
        <span className={`${styles.proposalStatus} ${styles[`proposalStatus_${proposal.status}`] ?? ""}`}>{statusChips[proposal.status] ?? proposal.status}</span>
        <h3 id={`proposal-${proposal.id}`}>{proposal.title}</h3>
        <p className={styles.proposalMeta}>{metadata}</p>
        <p>{proposal.summary}</p>
        {proposal.details ? <p>{proposal.details}</p> : null}
      </div>
      <div className={styles.proposalControls}>
        {canSubmit || canCorrect ? <button type="button" className={styles.smallButtonQuiet} disabled={pending} onClick={()=>setEditing(value=>!value)}>{editing ? "Cerrar edición" : canCorrect ? "Corregir propuesta" : "Editar borrador"}</button> : null}
        {canSubmit ? <button type="button" className={styles.smallButton} disabled={pending || editing} onClick={onSubmit}>{proposal.reviewNotes ? "Enviar corrección a revisión" : "Enviar a revisión"}</button> : null}
        {canSubmit ? <button type="button" className={styles.smallButtonQuiet} disabled={pending || editing}
          onClick={() => { if (window.confirm(`¿Eliminar el borrador «${proposal.title}»? Esta acción no se puede deshacer.`)) onDelete(); }}>Eliminar borrador</button> : null}
        {canManageVoting && canVoteOnProposal ? <button type="button"
          className={proposal.voting.isOpen ? styles.smallButtonQuiet : styles.smallButton}
          disabled={pending}
          onClick={() => onToggleVoting(!proposal.voting.isOpen)}>
          {proposal.voting.isOpen ? "Cerrar votación" : showBallot ? "Reabrir votación · conservar votos" : "Activar votación"}
        </button> : null}
      </div>
    </div>

    {editing && (canSubmit || canCorrect) ? <form className={styles.formCard} onSubmit={edit}>
      {canCorrect ? <p className={styles.empty}>Revisa el motivo del rechazo y corrige la propuesta. Al guardar volverá a borrador; después podrás enviarla de nuevo a revisión.</p> : null}
      <label>Título<input name="title" required minLength={3} maxLength={180} defaultValue={proposal.title}/></label>
      <label>Resumen<textarea name="summary" required minLength={10} maxLength={1200} defaultValue={proposal.summary}/></label>
      <label>Detalles<textarea name="details" maxLength={4000} defaultValue={proposal.details}/></label>
      <button className={styles.smallButton} disabled={pending}>{canCorrect ? "Guardar corrección como borrador" : "Guardar cambios"}</button>
    </form> : null}
    {proposal.reviewNotes ? <p className={styles.proposalNotes}><strong>{notesLabel(proposal.status)}:</strong> {proposal.reviewNotes}</p> : null}
    {!showBallot && notice ? <p className={styles.proposalRoundNotice}>{notice}</p> : null}
    {proposal.status === "submitted" && proposal.createdBy === currentUserId ? <p className={styles.proposalVotingHelp}>Pendiente de revisión por coordinación.</p> : null}
    {showBallot ? <section className={styles.proposalVoting} aria-label={`Votación de ${proposal.title}`}>
      <div className={styles.proposalVotingHeader}>
        <p className={styles.cardLabel}>Votación del club</p>
        <span className={proposal.voting.isOpen ? styles.proposalVoteOpen : styles.proposalVoteClosed}>
          {proposal.voting.isOpen ? "Abierta" : "Cerrada"}
        </span>
      </div>
      {notice ? <p className={styles.proposalRoundNotice}>{notice}</p> : null}
      {proposal.voting.voters !== null && proposal.voting.eligibleVoters !== null
        ? <p className={styles.proposalVotingHelp}><strong>Participación:</strong> {proposal.voting.voters} de {proposal.voting.eligibleVoters} miembros activos han votado.</p> : null}
      {proposal.voting.isOpen ? <>
        <p className={styles.proposalVotingHelp}>
          {proposal.voting.myVote
            ? `Tu voto actual: ${recordedVote}. Puedes cambiarlo mientras siga abierta.`
            : "Emite tu voto. Puedes cambiarlo mientras la votación siga abierta; los resultados se mostrarán al cerrarla."}
        </p>
        <div className={styles.proposalVoteChoices} role="group" aria-label={`Tu voto para ${proposal.title}`}>
          {voteChoices.map((choice) => <button type="button" key={choice.value}
            className={proposal.voting.myVote === choice.value
              ? `${styles.proposalVoteChoice} ${styles.proposalVoteChoiceSelected}`
              : styles.proposalVoteChoice}
            aria-pressed={proposal.voting.myVote === choice.value}
            disabled={pending}
            onClick={() => onVote(choice.value)}>
            {choice.label}
          </button>)}
        </div>
      </> : <>
        <div className={styles.proposalVoteTally} aria-label="Resultados de la votación">
          <div><span>A favor</span><strong>{proposal.voting.votesFor ?? 0}</strong></div>
          <div><span>En contra</span><strong>{proposal.voting.votesAgainst ?? 0}</strong></div>
          <div><span>Abstenciones</span><strong>{proposal.voting.votesAbstaining ?? 0}</strong></div>
        </div>
        <p className={styles.proposalVotingHelp}>
          {proposal.voting.myVote
            ? `Tu voto registrado: ${recordedVote}.`
            : "La votación está cerrada. Los resultados muestran el conteo total, sin identificar votos individuales."}
        </p>
        {canManageVoting && canVoteOnProposal ? <p className={styles.proposalVotingHelp}>Al reabrir esta votación se conservarán los votos registrados. Los miembros podrán cambiar su voto mientras esté abierta.</p> : null}
      </>}
    </section> : null}
    {canManageVoting && proposal.status !== "draft" && proposal.status !== "archived" ? <details className={styles.proposalReview}><summary>Revisar y registrar decisión</summary><form className={styles.formCard} onSubmit={review}>
      <label>Decisión<select name="decision" value={decision} onChange={(event) => setDecision(event.target.value as ReviewDecision)}><option value="in_review">Marcar en revisión</option><option value="approved">Aprobar</option><option value="rejected">Devolver al autor</option><option value="archived">Archivar</option></select></label>
      <label>{decision === "rejected" ? "Motivo de la devolución (obligatorio)" : "Notas para el autor"}<textarea name="notes" maxLength={4000} required={decision === "rejected"} minLength={decision === "rejected" ? 10 : undefined} defaultValue={proposal.reviewNotes ?? ""} placeholder={decision === "rejected" ? "Explica qué debe corregir el autor (mínimo 10 caracteres)." : "Opcional."}/></label>
      <button className={styles.smallButton} disabled={pending || proposal.voting.isOpen}>Guardar decisión</button>{proposal.voting.isOpen ? <p className={styles.empty}>Cierra la votación antes de registrar una decisión.</p> : null}</form></details> : null}
    {tasks.length > 0 || (canManageVoting && proposal.status === "approved") ? <section className={styles.proposalTasks} aria-label={`Tareas de ${proposal.title}`}>
      <div className={styles.proposalVotingHeader}><p className={styles.cardLabel}>Tareas de la propuesta</p>
        {canManageVoting && proposal.status === "approved" ? <button type="button" className={styles.smallButtonQuiet} disabled={pending} onClick={() => setCreatingTask(value => !value)}>{creatingTask ? "Cerrar" : "Crear tarea"}</button> : null}</div>
      {tasks.map(task => <p key={task.id} className={styles.proposalVotingHelp}><strong>{task.title}</strong> · {taskStatusLabels[task.status] ?? task.status} · {task.assigneeId ? names.get(task.assigneeId) ?? "Miembro asignado" : "Sin responsable"}{task.dueAt ? ` · Vence ${formatClubDate(task.dueAt)}` : ""}</p>)}
      {tasks.length === 0 && !creatingTask ? <p className={styles.proposalVotingHelp}>Aprobada: convierte la propuesta en tareas con responsable y fecha.</p> : null}
      {creatingTask ? <form className={styles.formCard} onSubmit={createTask}>
        <label>Tarea<input name="title" required minLength={2} maxLength={180} placeholder="Ej. Conseguir permisos de la junta de vecinos" /></label>
        <label>Responsable<select name="assigneeId" defaultValue=""><option value="">Sin responsable por ahora</option>{members.map(member => <option key={member.userId} value={member.userId}>{member.name}</option>)}</select></label>
        <label>Fecha límite<input name="dueAt" type="datetime-local" /></label>
        <label>Prioridad<select name="priority" defaultValue="normal"><option value="low">Baja</option><option value="normal">Normal</option><option value="high">Alta</option><option value="urgent">Urgente</option></select></label>
        <button className={styles.smallButton} disabled={pending}>Crear tarea</button>
      </form> : null}
    </section> : null}
    {proposal.history.length > 0 ? <details className={styles.proposalReview}><summary>Historial ({proposal.history.length})</summary>
      <ol className={styles.proposalHistory}>{[...proposal.history].reverse().map(entry => <li key={entry.id}>
        <strong>{historyLabels[entry.event]}</strong> · {formatClubDate(entry.createdAt)} · {entry.actorName}{entry.round > 1 ? ` · ronda ${entry.round}` : ""}
        {entry.tally ? <span> · {tallyText(entry.tally)}</span> : null}
        {entry.notes ? <span className={styles.proposalHistoryNotes}>{entry.notes}</span> : null}
      </li>)}</ol>
    </details> : null}
  </article>;
}
