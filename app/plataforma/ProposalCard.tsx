"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import type { PlatformProposal, ProposalVoteChoice } from "@/lib/platform";

import styles from "./platform.module.css";

const voteChoices: Array<{ value: ProposalVoteChoice; label: string }> = [
  { value: "for", label: "A favor" },
  { value: "against", label: "En contra" },
  { value: "abstain", label: "Abstenerme" },
];

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
  onReview: (input: {status:"in_review"|"approved"|"rejected"|"archived";notes:string}) => void;
}) {
  const [editing,setEditing]=useState(false);
  function edit(event:FormEvent<HTMLFormElement>) { event.preventDefault();const data=new FormData(event.currentTarget);onEdit({title:String(data.get("title")),summary:String(data.get("summary")),details:String(data.get("details"))},()=>setEditing(false)); }
  function review(event:FormEvent<HTMLFormElement>) {event.preventDefault();const data=new FormData(event.currentTarget);onReview({status:String(data.get("decision")) as "in_review"|"approved"|"rejected"|"archived",notes:String(data.get("notes"))});}
  const canSubmit = proposal.status === "draft" && proposal.createdBy === currentUserId;
  const canCorrect = proposal.status === "rejected" && proposal.createdBy === currentUserId;
  const canVoteOnProposal = proposal.status === "submitted" || proposal.status === "in_review";
  const showBallot = proposal.voting.startedAt !== null;

  return <article className={styles.proposalItem} aria-labelledby={`proposal-${proposal.id}`}>
    <div className={styles.proposalItemHeader}>
      <div className={styles.proposalMain}>
        <h3 id={`proposal-${proposal.id}`}>{proposal.title}</h3>
        <p className={styles.proposalMeta}>{metadata}</p>
        <p>{proposal.summary}</p>
        {proposal.details ? <p>{proposal.details}</p> : null}
      </div>
      <div className={styles.proposalControls}>
        {canSubmit || canCorrect ? <button type="button" className={styles.smallButtonQuiet} disabled={pending} onClick={()=>setEditing(value=>!value)}>{editing ? "Cerrar edición" : canCorrect ? "Corregir propuesta" : "Editar borrador"}</button> : null}
        {canSubmit ? <button type="button" className={styles.smallButton} disabled={pending || editing} onClick={onSubmit}>{proposal.reviewNotes ? "Enviar corrección a revisión" : "Enviar a revisión"}</button> : null}
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
    {proposal.reviewNotes ? <p className={styles.empty}>Notas de revisión: {proposal.reviewNotes}</p> : null}
    {canManageVoting && proposal.status !== "draft" && proposal.status !== "archived" ? <details className={styles.proposalReview}><summary>Revisar y registrar decisión</summary><form className={styles.formCard} onSubmit={review}><label>Decisión<select name="decision" defaultValue={proposal.status === "approved" || proposal.status === "rejected" ? proposal.status : "in_review"}><option value="in_review">En revisión</option><option value="approved">Aprobar</option><option value="rejected">Rechazar</option><option value="archived">Archivar</option></select></label><label>Motivo / notas<textarea name="notes" maxLength={4000} defaultValue={proposal.reviewNotes ?? ""} placeholder="Explica la decisión; obligatorio al rechazar."/></label><button className={styles.smallButton} disabled={pending || proposal.voting.isOpen}>Guardar decisión</button>{proposal.voting.isOpen ? <p className={styles.empty}>Cierra la votación antes de registrar una decisión.</p> : null}</form></details> : null}
    {showBallot ? <section className={styles.proposalVoting} aria-label={`Votación de ${proposal.title}`}>
      <div className={styles.proposalVotingHeader}>
        <p className={styles.cardLabel}>Votación del club</p>
        <span className={proposal.voting.isOpen ? styles.proposalVoteOpen : styles.proposalVoteClosed}>
          {proposal.voting.isOpen ? "Abierta" : "Cerrada"}
        </span>
      </div>
      {proposal.voting.isOpen ? <>
        <p className={styles.proposalVotingHelp}>
          {proposal.voting.myVote
            ? `Tu voto actual: ${voteChoices.find((choice) => choice.value === proposal.voting.myVote)?.label}. Puedes cambiarlo mientras siga abierta.`
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
            ? `Tu voto registrado: ${voteChoices.find((choice) => choice.value === proposal.voting.myVote)?.label}.`
            : "La votación está cerrada. Los resultados muestran el conteo total, sin identificar votos individuales."}
        </p>
        {canManageVoting && canVoteOnProposal ? <p className={styles.proposalVotingHelp}>Al reabrir esta votación se conservarán los votos registrados. Los miembros podrán cambiar su voto mientras esté abierta.</p> : null}
      </>}
    </section> : null}
  </article>;
}
