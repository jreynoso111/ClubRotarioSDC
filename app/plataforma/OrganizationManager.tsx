"use client";

import { useCallback, useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { PlatformCommittee, PlatformTask } from "@/lib/platform";
import { buildLeadershipTree, currentRotaryYear, leadershipDescendants, leadershipYearLabel, organizationAccessLevels, type LeadershipNode, type LeadershipPosition, type OrganizationData } from "@/lib/organization";
import type { PlatformRole } from "@/lib/platform";
import type { PlatformActionResult } from "./actions";
import { createLeadershipTermAction, getOrganizationAction, saveLeadershipPositionAction, setLeadershipTermLockAction } from "./organization-actions";
import { MembersManager } from "./MembersManager";
import { CommitteeManager } from "./CommitteeManager";
import platformStyles from "./platform.module.css";
import styles from "./organization.module.css";

type PositionDraft = { id: string | null; title: string; responsibilities: string; memberId: string; parentId: string; sortOrder: number; active: boolean; accessRole: PlatformRole; applyAccess: boolean; updatedAt?: string };
function draftFrom(position?: LeadershipPosition, memberId?: string): PositionDraft {
  return { id: position?.id ?? null, title: position?.title ?? "", responsibilities: position?.responsibilities ?? "", memberId: memberId ?? position?.memberId ?? "", parentId: position?.parentId ?? "", sortOrder: position?.sortOrder ?? 70, active: position?.active ?? true, accessRole: position?.accessRole ?? "member", applyAccess: false, updatedAt: position?.updatedAt };
}
function initials(name: string) { return name.split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase(); }

function LeadershipBranch({ node, canEdit, onEdit, onOpenMember, root = false }: {
  node: LeadershipNode; canEdit: boolean; onEdit: (position: LeadershipPosition) => void; onOpenMember: (id: string) => void; root?: boolean;
}) {
  return <li className={styles.branch}>
    <article className={`${styles.positionCard} ${root ? styles.rootCard : ""}`}>
      <h3>{node.title}</h3>
      <span className={styles.accessBadge}>Acceso del cargo: {organizationAccessLevels.find(level => level.id === node.accessRole)?.label ?? "Miembro"}</span>
      {node.memberId ? <button type="button" className={styles.person} onClick={() => onOpenMember(node.memberId!)}><span className={styles.avatar}>{initials(node.memberName ?? "Miembro")}</span><span><strong>{node.memberName ?? "Perfil del miembro"}</strong><small>Ver perfil →</small></span></button>
        : <p className={styles.vacancy}><span />Cargo por asignar</p>}
      {node.responsibilities && <p className={styles.responsibilities}>{node.responsibilities}</p>}
      {canEdit && <button type="button" className={styles.editPosition} onClick={() => onEdit(node)} aria-label={`Editar ${node.title}`}>{node.memberId ? "Editar cargo" : "Asignar miembro"} ↗</button>}
    </article>
    {node.children.length > 0 && <ul className={styles.treeChildren}>{node.children.map(child => <LeadershipBranch key={child.id} node={child} canEdit={canEdit} onEdit={onEdit} onOpenMember={onOpenMember} />)}</ul>}
  </li>;
}

export function OrganizationManager({ currentUserId, committees, tasks, canManageMembers, canManageCommittees, canManageOrganization }: {
  currentUserId: string; committees: PlatformCommittee[]; tasks: PlatformTask[]; canManageMembers: boolean; canManageCommittees: boolean; canManageOrganization: boolean;
}) {
  const router = useRouter();
  const [view, setView] = useState<"organigrama" | "miembros" | "comites">("organigrama");
  const [organization, setOrganization] = useState<OrganizationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<PlatformActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const [editor, setEditor] = useState<PositionDraft | null>(null);
  const [assignmentMember, setAssignmentMember] = useState<string | null>(null);
  const [newTerm, setNewTerm] = useState<{ year: number; label: string; template: string } | null>(null);
  const [selectedMemberId, setSelectedMemberId] = useState("");
  const [memberQuery, setMemberQuery] = useState("");
  const requests = useRef({ id: 0, mounted: true });
  const dialog = useRef<HTMLDialogElement>(null);

  const load = useCallback(async (termId?: string) => {
    const request = ++requests.current.id;
    setLoading(true);
    try {
      const result = await getOrganizationAction(termId);
      if (!requests.current.mounted || request !== requests.current.id) return;
      if (result.ok && result.organization) setOrganization(result.organization);
      else setFeedback(result);
    } catch { if (requests.current.mounted && request === requests.current.id) setFeedback({ ok: false, message: "No se pudo cargar el organigrama. Vuelve a intentar." }); }
    finally { if (requests.current.mounted && request === requests.current.id) setLoading(false); }
  }, []);
  useEffect(() => {
    const scope = requests.current;
    scope.mounted = true;
    const request = ++scope.id;
    void getOrganizationAction().then(result => {
      if (!scope.mounted || request !== scope.id) return;
      if (result.ok && result.organization) setOrganization(result.organization);
      else setFeedback(result);
    }).catch(() => { if (scope.mounted && request === scope.id) setFeedback({ ok: false, message: "No se pudo cargar el organigrama. Vuelve a intentar." }); })
      .finally(() => { if (scope.mounted && request === scope.id) setLoading(false); });
    return () => { scope.mounted = false; scope.id++; };
  }, []);
  useEffect(() => {
    if (editor || newTerm) { if (!dialog.current?.open) dialog.current?.showModal(); }
    else dialog.current?.close();
  }, [editor, newTerm]);

  const term = organization?.terms.find(item => item.id === organization.termId);
  const positions = organization?.positions ?? [];
  const activePositions = positions.filter(position => position.active);
  const canEdit = canManageOrganization && Boolean(term) && !term?.locked && !loading;
  const tree = buildLeadershipTree(positions);
  const yearLabel = term ? leadershipYearLabel(term.startYear) : leadershipYearLabel(currentRotaryYear());
  const selectedProfile = organization?.members.find(member => member.userId === selectedMemberId);
  const memberPositions = positions.filter(position => position.memberId === selectedMemberId && position.active);
  const excludedParents = editor?.id ? leadershipDescendants(positions, editor.id) : new Set<string>();

  function run(action: () => Promise<PlatformActionResult>, after?: (result: PlatformActionResult) => void) {
    startTransition(async () => {
      try {
        const result = await action();
        setFeedback(result);
        if (result.ok) { after?.(result); await load(result.id && newTerm ? result.id : term?.id); router.refresh(); }
      } catch { setFeedback({ ok: false, message: "No se pudo guardar. Los datos siguen en el formulario." }); }
    });
  }
  function edit(position?: LeadershipPosition, memberId?: string) {
    if (!canEdit) return;
    setFeedback(null);
    setAssignmentMember(memberId ?? null);
    setNewTerm(null);
    setEditor(draftFrom(position, memberId));
  }
  function openMember(id: string) { setSelectedMemberId(id); setView("miembros"); }
  function closeEditor() { if (!pending) { setEditor(null); setNewTerm(null); setAssignmentMember(null); } }
  function savePosition(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor || !term) return;
    const values = { ...editor, termId: term.id, memberId: editor.memberId || null, parentId: editor.parentId || null };
    run(() => saveLeadershipPositionAction(values), () => { setEditor(null); setAssignmentMember(null); });
  }
  function saveTerm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!newTerm) return;
    const values = { startYear: newTerm.year, label: newTerm.label, templateTermId: newTerm.template || null };
    run(() => createLeadershipTermAction(values), () => { setNewTerm(null); setView("organigrama"); });
  }

  return <section className={styles.workspace}>
    <div className={styles.toolbar}>
      <nav className={styles.views} aria-label="Vistas de organización">{([ ["organigrama", "Organigrama"], ["miembros", "Miembros"], ["comites", "Comités"] ] as const).map(([id, label]) => <button type="button" key={id} aria-pressed={view === id} onClick={() => setView(id)}>{label}</button>)}</nav>
      {organization && organization.terms.length > 0 && <label className={styles.yearSelect}>Año rotario<select value={organization.termId ?? ""} disabled={loading || pending} onChange={event => { setFeedback(null); void load(event.target.value); }}>{organization.terms.map(item => <option key={item.id} value={item.id}>{leadershipYearLabel(item.startYear)}{item.label ? ` · ${item.label}` : ""}{item.locked ? " · Edición cerrada" : ""}</option>)}</select></label>}
    </div>
    {feedback && <p className={`${styles.feedback} ${feedback.ok ? "" : styles.error}`} role={feedback.ok ? "status" : "alert"}>{feedback.message}{!feedback.ok && !editor && !newTerm && <button type="button" onClick={() => void load(term?.id)}>Volver a cargar</button>}</p>}
    {loading && <p className={styles.empty} role="status">Cargando estructura del club…</p>}
    {!loading && view === "organigrama" && <>
      <div className={styles.heading}><div><p className={styles.kicker}>JUNTA DIRECTIVA DEL CLUB</p><h2>Organigrama {yearLabel}</h2><p>Del 1 de julio al 30 de junio. Cada cargo se asigna a un perfil para este período.</p>{term?.label && <span className={styles.periodLabel}>{term.label}</span>}</div>
        {canManageOrganization && <div className={styles.actions}>
          {canEdit && <button type="button" className={styles.button} onClick={() => edit()}>Agregar cargo +</button>}
          <button type="button" className={styles.quietButton} disabled={pending} onClick={() => { setFeedback(null); setEditor(null); setNewTerm({ year: term ? term.startYear + 1 : currentRotaryYear(), label: "", template: term?.id ?? "" }); }}>{term ? "Nuevo período" : "Definir directiva"}</button>
          {term && <button type="button" className={styles.textButton} disabled={pending} onClick={() => run(() => setLeadershipTermLockAction({ termId: term.id, locked: !term.locked, updatedAt: term.updatedAt }))}>{term.locked ? "Reabrir edición" : "Cerrar edición"}</button>}
        </div>}
      </div>
      <p className={styles.explanation}>Administración define cada cargo y su nivel de acceso. Asignar un cargo conserva los permisos del miembro hasta que administración elija aplicarlos a su perfil.</p>
      {term?.locked && <p className={styles.closedNotice}>Este período tiene la edición cerrada para conservar su directiva.</p>}
      {term && activePositions.length > 0 ? <div className={styles.chart} aria-label={`Organigrama del club ${yearLabel}`}><div className={styles.chartLegend}><span>{activePositions.filter(position => position.memberId).length} cargos asignados</span><span>{activePositions.filter(position => !position.memberId).length} por asignar</span></div><ul className={styles.treeRoots}>{tree.map(node => <LeadershipBranch key={node.id} node={node} root canEdit={canEdit && !pending} onEdit={edit} onOpenMember={openMember} />)}</ul></div>
        : <div className={styles.emptyCard}><h3>{term ? "El organigrama está por definir." : "El club todavía no ha definido su directiva."}</h3><p>{canManageOrganization ? "Define el año rotario, asigna los miembros y adapta los cargos a la estructura del club." : "Cuando administración defina los cargos, podrás consultar aquí la directiva y los perfiles de sus integrantes."}</p></div>}
      {positions.some(position => !position.active) && <details className={styles.retired}><summary>Cargos retirados de este organigrama ({positions.filter(position => !position.active).length})</summary>{positions.filter(position => !position.active).map(position => <div key={position.id}><strong>{position.title}</strong><span>{position.memberName ?? "Sin asignación"}</span>{canEdit && <button type="button" className={styles.textButton} onClick={() => edit(position)}>Editar y recuperar</button>}</div>)}</details>}
      {term?.startYear === currentRotaryYear() && <div className={styles.committees}><div className={styles.heading}><div><h3>Comités del club</h3><p>Composición actual de los equipos de trabajo.</p></div><button type="button" className={styles.quietButton} onClick={() => setView("comites")}>Ver comités →</button></div><div className={styles.committeeGrid}>{committees.filter(committee => committee.isActive).map(committee => <article key={committee.id}><h4>{committee.name}</h4><p>{committee.members.filter(member => member.role === "chair").map(member => member.name).join(", ") || "Presidencia del comité por asignar"}</p><small>{committee.members.length} integrantes</small></article>)}</div>{committees.every(committee => !committee.isActive) && <p className={styles.empty}>Todavía no hay comités activos. Puedes definirlos en la vista Comités.</p>}</div>}
    </>}
    {!loading && view === "miembros" && (canManageMembers ? <MembersManager key={selectedMemberId} currentUserId={currentUserId} committees={committees} tasks={tasks}
      initialMemberId={selectedMemberId} leadershipPositions={positions} leadershipYear={yearLabel}
      onAssignPosition={canEdit ? id => edit(activePositions.find(position => !position.memberId), id) : undefined} />
      : <div className={styles.directory}><label>Buscar miembro<input type="search" value={memberQuery} onChange={event => setMemberQuery(event.target.value)} placeholder="Nombre del miembro" /></label><div className={styles.directoryLayout}><div className={styles.directoryList}>{organization?.members.filter(member => member.name.toLocaleLowerCase("es").includes(memberQuery.toLocaleLowerCase("es"))).map(member => <button type="button" key={member.userId} aria-pressed={selectedMemberId === member.userId} onClick={() => setSelectedMemberId(member.userId)}><span className={styles.avatar}>{initials(member.name)}</span><span><strong>{member.name}</strong><small>{positions.filter(position => position.memberId === member.userId && position.active).map(position => position.title).join(" · ") || "Miembro del club"}</small></span></button>)}</div><article className={styles.profile}><h3>{selectedProfile?.name ?? positions.find(position => position.memberId === selectedMemberId)?.memberName ?? "Selecciona un miembro"}</h3>{selectedProfile?.bio && <p>{selectedProfile.bio}</p>}{memberPositions.length > 0 && <><h4>Cargos rotarios · {yearLabel}</h4><ul>{memberPositions.map(position => <li key={position.id}><strong>{position.title}</strong>{position.responsibilities && <p>{position.responsibilities}</p>}</li>)}</ul></>}{selectedProfile && memberPositions.length === 0 && <p>Este miembro no tiene cargos asignados en el período seleccionado.</p>}</article></div></div>)}
    {view === "comites" && <section className={platformStyles.moduleGrid}><CommitteeManager committees={committees} candidates={organization?.members ?? []} canManage={canManageCommittees} /></section>}
    <dialog ref={dialog} className={styles.dialog} aria-labelledby="organization-editor-title" onCancel={event => { event.preventDefault(); closeEditor(); }}>
      <div className={styles.dialogHeading}><h2 id="organization-editor-title">{newTerm ? "Definir año rotario" : assignmentMember ? "Asignar cargo al miembro" : editor?.id ? "Editar cargo" : "Agregar cargo"}</h2><button type="button" className={styles.close} disabled={pending} onClick={closeEditor} aria-label="Cerrar formulario de organigrama">×</button></div>
      {feedback && !feedback.ok && <p className={`${styles.feedback} ${styles.error}`} role="alert">{feedback.message}</p>}
      {newTerm && <form className={styles.form} onSubmit={saveTerm}><label>Año de inicio<input type="number" min={1970} max={2200} required value={newTerm.year} onChange={event => setNewTerm({ ...newTerm, year: Number(event.target.value) })} /></label><p className={styles.muted}>Período: 1 de julio de {newTerm.year} a 30 de junio de {newTerm.year + 1}.</p><label>Nombre del período (opcional)<input maxLength={120} value={newTerm.label} onChange={event => setNewTerm({ ...newTerm, label: event.target.value })} placeholder="Ej. Directiva del club" /></label><label>Estructura inicial<select value={newTerm.template} onChange={event => setNewTerm({ ...newTerm, template: event.target.value })}><option value="">Cargos rotarios iniciales</option>{organization?.terms.map(item => <option key={item.id} value={item.id}>Copiar cargos de {leadershipYearLabel(item.startYear)}</option>)}</select></label><p className={styles.muted}>Se copian los cargos y su jerarquía. Las asignaciones de miembros comienzan vacías; las directivas anteriores se conservan.</p><button className={styles.button} disabled={pending}>{pending ? "Guardando…" : "Crear período"}</button></form>}
      {editor && <form className={styles.form} onSubmit={savePosition}>
        {assignmentMember && <label>Cargo que deseas asignar<select value={editor.id ?? "new"} onChange={event => setEditor(draftFrom(positions.find(position => position.id === event.target.value), assignmentMember))}><option value="new">Crear un cargo nuevo</option>{activePositions.map(position => <option key={position.id} value={position.id}>{position.title}{position.memberName ? ` · ${position.memberName}` : " · Vacante"}</option>)}</select></label>}
        <label>Nombre del cargo<input value={editor.title} required minLength={2} maxLength={100} onChange={event => setEditor({ ...editor, title: event.target.value })} placeholder="Ej. Contabilidad, Dirección de proyectos" /></label>
        <label>Miembro asignado<select value={editor.memberId} onChange={event => setEditor({ ...editor, memberId: event.target.value, applyAccess: false })}><option value="">Cargo por asignar</option>{editor.memberId && !organization?.members.some(member => member.userId === editor.memberId) && <option value={editor.memberId}>{positions.find(position => position.id === editor.id)?.memberName ?? "Miembro del período"} · Asignación histórica</option>}{organization?.members.map(member => <option key={member.userId} value={member.userId}>{member.name}</option>)}</select></label>
        <label>Depende de<select value={editor.parentId} onChange={event => setEditor({ ...editor, parentId: event.target.value })}><option value="">Sin cargo superior</option>{activePositions.filter(position => !excludedParents.has(position.id)).map(position => <option key={position.id} value={position.id}>{position.title}</option>)}</select></label>
        <label>Nivel de acceso del cargo<select value={editor.accessRole} onChange={event => setEditor({ ...editor, accessRole: event.target.value as PlatformRole })}>{organizationAccessLevels.map(level => <option key={level.id} value={level.id}>{level.label}</option>)}</select></label>
        <p className={styles.muted}>{organizationAccessLevels.find(level => level.id === editor.accessRole)?.description}</p>
        {term?.startYear === currentRotaryYear() && editor.memberId && editor.active && <div className={styles.accessPreview}><label className={styles.checkbox}><input type="checkbox" checked={editor.applyAccess} onChange={event => setEditor({ ...editor, applyAccess: event.target.checked })} />Aplicar este acceso al perfil al guardar</label><p>Acceso actual: {organizationAccessLevels.find(level => level.id === organization?.members.find(member => member.userId === editor.memberId)?.accessRole)?.label ?? "Consultar ficha"}. {editor.applyAccess ? `Al guardar será ${organizationAccessLevels.find(level => level.id === editor.accessRole)?.label}.` : "Se conservará mientras esta opción esté desmarcada."}</p></div>}
        {term?.startYear !== currentRotaryYear() && <p className={styles.muted}>Las asignaciones de períodos anteriores o futuros conservan los permisos actuales de las cuentas.</p>}
        <label>Responsabilidades<textarea value={editor.responsibilities} maxLength={1200} onChange={event => setEditor({ ...editor, responsibilities: event.target.value })} placeholder="Describe las funciones del cargo dentro del club." /></label>
        <div className={styles.formRow}><label>Orden en el organigrama<input type="number" min={0} max={999} required value={editor.sortOrder} onChange={event => setEditor({ ...editor, sortOrder: Number(event.target.value) })} /></label><label className={styles.checkbox}><input type="checkbox" checked={editor.active} onChange={event => setEditor({ ...editor, active: event.target.checked, applyAccess: false })} />Mostrar cargo en el organigrama</label></div>
        {!editor.active && <p className={styles.muted}>El cargo se retira de la vista y conserva su registro. Primero reubica los cargos que dependen de él.</p>}
        <button className={styles.button} disabled={pending}>{pending ? "Guardando…" : "Guardar cargo y asignación"}</button>
      </form>}
    </dialog>
  </section>;
}
