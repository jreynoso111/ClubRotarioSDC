"use client";

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
}: {
  proposal: PlatformProposal;
  metadata: string;
  currentUserId: string;
  canManageVoting: boolean;
  pending: boolean;
  onSubmit: () => void;
  onToggleVoting: (enabled: boolean) => void;
  onVote: (choice: ProposalVoteChoice) => void;
}) {
  const canSubmit = proposal.status === "draft" && proposal.createdBy === currentUserId;
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
        {canSubmit ? <button type="button" className={styles.smallButton} disabled={pending} onClick={onSubmit}>Enviar a revisión</button> : null}
        {canManageVoting && canVoteOnProposal ? <button type="button"
          className={proposal.voting.isOpen ? styles.smallButtonQuiet : styles.smallButton}
          disabled={pending}
          onClick={() => onToggleVoting(!proposal.voting.isOpen)}>
          {proposal.voting.isOpen ? "Cerrar votación" : "Activar votación"}
        </button> : null}
      </div>
    </div>

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
      </>}
    </section> : null}
  </article>;
}
