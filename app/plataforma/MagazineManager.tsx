"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";

import { formatClubDate } from "@/lib/club-date";
import { editorialLayouts, parseEditorialContent } from "@/lib/editorial-content";
import type { PlatformStory } from "@/lib/platform";

import {
  deleteStoryAction,
  listStoriesAction,
  setStoryStatusAction,
  submitStoryForReviewAction,
  type PlatformActionResult,
} from "./actions";
import { StoryComposerDialog } from "./StoryComposerDialog";
import platform from "./platform.module.css";
import styles from "./magazine.module.css";

type StatusFilter = "all" | "draft" | "review" | "published" | "archived";
type SectionFilter = "all" | "cronica" | "voces" | "archivo" | "noticia" | "otro";
type ListQuery = { status: StatusFilter; section: SectionFilter; search: string; page: number };
type ListData = { stories: PlatformStory[]; total: number; page: number; pageSize: number };
type Notice = { message: string; isError: boolean };
// Null while closed. The dialog is mounted only while open, so each opening reads the stored story.
type Composer = { story?: PlatformStory } | null;

const statusOptions: StatusFilter[] = ["all", "draft", "review", "published", "archived"];
const statusLabels: Record<Exclude<StatusFilter, "all">, string> = {
  draft: "Borrador", review: "En revisión", published: "Publicado", archived: "Archivado",
};
const statusBadgeClass: Record<Exclude<StatusFilter, "all">, string> = {
  draft: styles.badgeDraft, review: styles.badgeReview, published: styles.badgePublished, archived: styles.badgeArchived,
};
const sectionOptions: SectionFilter[] = ["all", "cronica", "voces", "archivo", "noticia", "otro"];
const sectionLabels: Record<SectionFilter, string> = {
  all: "Todas", cronica: "Crónica", voces: "Voces del club", archivo: "Archivo", noticia: "Noticia", otro: "Otra historia",
};

function countLabel(total: number) {
  return `${total} ${total === 1 ? "texto" : "textos"}`;
}

function disclosureFor(canWrite: boolean, canPublish: boolean) {
  if (canPublish) return "Puedes publicar, pasar a borrador, archivar y eliminar textos. Pueden publicar la gestión del club y las personas de edición con permiso.";
  if (canWrite) return "Puedes escribir borradores y enviarlos a revisión. Solo la gestión del club y las personas de edición con permiso pueden publicarlos.";
  return "Aquí ves las publicaciones que el club ha hecho públicas. La gestión del club y las personas de edición con permiso pueden publicar.";
}

// What a person may do with one story; the database enforces the same rules when a change is saved.
function actionsFor(story: PlatformStory, canWrite: boolean, canPublish: boolean) {
  const writable = story.status === "draft" || story.status === "review";
  return {
    edit: canPublish || (canWrite && writable),
    submit: canWrite && !canPublish && story.status === "draft",
    publish: canPublish && story.status !== "published",
    draft: canPublish && story.status !== "draft",
    archive: canPublish && story.status !== "archived",
    remove: canPublish,
  };
}

export function MagazineManager({ canWrite, canPublish }: { canWrite: boolean; canPublish: boolean }) {
  const [query, setQuery] = useState<ListQuery>({ status: "all", section: "all", search: "", page: 1 });
  const [searchDraft, setSearchDraft] = useState("");
  const [data, setData] = useState<ListData | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [composer, setComposer] = useState<Composer>(null);

  // Only the newest request may update the list, so an older response cannot overwrite a newer filter.
  const requestList = useCallback((next: ListQuery) => {
    return listStoriesAction({ status: next.status, type: next.section, search: next.search, page: next.page })
      .then(result => {
        if (result.ok) {
          setData({ stories: result.stories, total: result.total, page: result.page, pageSize: result.pageSize });
          if (result.page !== next.page) setQuery(current => ({ ...current, page: result.page }));
        } else {
          setData(null);
          setNotice({ message: result.message, isError: true });
        }
        setLoading(false);
      })
      .catch(() => {
        setData(null);
        setNotice({ message: "No se pudo cargar la revista. Inténtalo nuevamente.", isError: true });
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    void requestList(query);
  }, [query, requestList]);

  function changeQuery(patch: Partial<ListQuery>) {
    setLoading(true);
    setNotice(null);
    setQuery(current => ({ ...current, ...patch }));
  }

  function retry() {
    setLoading(true);
    setNotice(null);
    void requestList(query);
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    changeQuery({ search: searchDraft.trim(), page: 1 });
  }

  function clearSearch() {
    setSearchDraft("");
    changeQuery({ search: "", page: 1 });
  }

  // Row actions wait for the refreshed list, so a conflict shows what the other person saved.
  async function runAction(story: PlatformStory, action: () => Promise<PlatformActionResult>) {
    setPendingId(story.id);
    setNotice(null);
    try {
      const result = await action();
      if (result.ok || result.code === "conflict") {
        setLoading(true);
        await requestList(query);
      }
      setNotice({ message: result.message, isError: !result.ok });
    } catch {
      setNotice({ message: "No se pudo guardar el cambio. Inténtalo nuevamente.", isError: true });
    } finally {
      setPendingId(null);
    }
  }

  function confirmThen(question: string, action: () => void) {
    if (window.confirm(question)) action();
  }

  function handleSaved(message: string) {
    setComposer(null);
    setNotice({ message, isError: false });
    setLoading(true);
    void requestList(query);
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const filtered = query.status !== "all" || query.section !== "all" || query.search !== "";

  return (
    <section className={platform.moduleGrid} aria-label="Revista del club">
      <article className={`${platform.card} ${platform.cardWide} ${styles.magazineCard}`}>
        <div className={styles.heading}>
          <div><p className={platform.cardLabel}>Revista del club</p><h2 className={platform.cardTitle}>Publicaciones</h2></div>
          <div className={styles.headingActions}>
            {data ? <span className={platform.storyCount}>{countLabel(data.total)}</span> : null}
            {canWrite ? <button type="button" className={styles.newButton} onClick={() => { setNotice(null); setComposer({}); }}>
              <span aria-hidden="true">＋</span> Nueva publicación
            </button> : null}
          </div>
        </div>
        <p className={styles.disclosure}>{disclosureFor(canWrite, canPublish)}</p>

        <div className={styles.filters}>
          {canWrite ? <label>Estado
            <select value={query.status} disabled={loading} onChange={event => changeQuery({ status: event.target.value as StatusFilter, page: 1 })}>
              {statusOptions.map(option => <option key={option} value={option}>{option === "all" ? "Todos" : statusLabels[option]}</option>)}
            </select>
          </label> : null}
          <label>Tipo
            <select value={query.section} disabled={loading} onChange={event => changeQuery({ section: event.target.value as SectionFilter, page: 1 })}>
              {sectionOptions.map(option => <option key={option} value={option}>{sectionLabels[option]}</option>)}
            </select>
          </label>
          <form className={styles.search} role="search" onSubmit={submitSearch}>
            <label>Buscar por título
              <input type="search" value={searchDraft} maxLength={120} placeholder="Título de la publicación" onChange={event => setSearchDraft(event.target.value)} />
            </label>
            <button type="submit" className={platform.smallButtonQuiet} disabled={loading}>Buscar</button>
            {query.search ? <button type="button" className={platform.smallButtonQuiet} disabled={loading} onClick={clearSearch}>Limpiar</button> : null}
          </form>
        </div>

        {notice ? <p className={notice.isError ? platform.feedbackError : platform.feedbackSuccess} role={notice.isError ? "alert" : "status"}>{notice.message}</p> : null}
        {loading ? <p className={platform.empty} role="status">{data ? "Actualizando la revista…" : "Cargando la revista…"}</p> : null}
        {!loading && !data ? <button type="button" className={platform.smallButtonQuiet} onClick={retry}>Volver a cargar</button> : null}

        {data ? <>
          {data.stories.map(story => <StoryRow key={story.id} story={story} canWrite={canWrite} canPublish={canPublish}
            busy={pendingId !== null || loading} pending={pendingId === story.id}
            onEdit={() => { setNotice(null); setComposer({ story }); }}
            onSubmit={() => void runAction(story, () => submitStoryForReviewAction(story.id, story.updatedAt))}
            onPublish={() => void runAction(story, () => setStoryStatusAction(story.id, "published", story.updatedAt))}
            onDraft={() => confirmThen(
              story.status === "published" ? `¿Pasar «${story.title}» a borrador? Dejará de verse en la revista.` : `¿Pasar «${story.title}» a borrador?`,
              () => void runAction(story, () => setStoryStatusAction(story.id, "draft", story.updatedAt)),
            )}
            onArchive={() => confirmThen(`¿Archivar «${story.title}»? Dejará de verse en la revista.`,
              () => void runAction(story, () => setStoryStatusAction(story.id, "archived", story.updatedAt)))}
            onDelete={() => confirmThen(`¿Eliminar «${story.title}»? Se eliminará definitivamente; quedará en la auditoría.`,
              () => void runAction(story, () => deleteStoryAction(story.id)))} />)}
          {data.stories.length === 0 && !loading ? <p className={platform.empty}>
            {filtered ? "No hay publicaciones con estos filtros." : canWrite ? "Todavía no hay publicaciones. Crea la primera con «Nueva publicación»." : "Todavía no hay publicaciones en la revista."}
          </p> : null}
          {data.total > 0 ? <nav className={styles.pagination} aria-label="Paginación de la revista">
            <button type="button" className={platform.smallButtonQuiet} disabled={loading || data.page <= 1} onClick={() => changeQuery({ page: data.page - 1 })}>Anterior</button>
            <span>Página {data.page} de {totalPages} · {countLabel(data.total)}</span>
            <button type="button" className={platform.smallButtonQuiet} disabled={loading || data.page >= totalPages} onClick={() => changeQuery({ page: data.page + 1 })}>Siguiente</button>
          </nav> : null}
        </> : null}
      </article>

      {composer ? <StoryComposerDialog canPublish={canPublish} story={composer.story} onClose={() => setComposer(null)} onSaved={handleSaved} /> : null}
    </section>
  );
}

function StoryRow({ story, canWrite, canPublish, busy, pending, onEdit, onSubmit, onPublish, onDraft, onArchive, onDelete }: {
  story: PlatformStory; canWrite: boolean; canPublish: boolean; busy: boolean; pending: boolean;
  onEdit: () => void; onSubmit: () => void; onPublish: () => void; onDraft: () => void; onArchive: () => void; onDelete: () => void;
}) {
  const allowed = actionsFor(story, canWrite, canPublish);
  const editorial = parseEditorialContent(story.content);
  const layoutName = editorialLayouts.find(layout => layout.id === editorial?.layoutId)?.name ?? "Formato anterior";
  const status = (story.status in statusLabels ? story.status : "draft") as Exclude<StatusFilter, "all">;
  const hasActions = allowed.edit || allowed.submit || allowed.publish || allowed.draft || allowed.archive || allowed.remove;

  return (
    <article className={styles.row}>
      <div className={styles.meta}>
        <span className={`${styles.badge} ${statusBadgeClass[status]}`}>{statusLabels[status]}</span>
        <span>{sectionLabels[story.storyType as SectionFilter] ?? "Historia"}</span>
        <span>{layoutName}</span>
        <time>{story.publishedAt ? `Publicado el ${formatClubDate(story.publishedAt, false)}` : "Sin publicar"}</time>
      </div>
      <h3>{story.title}</h3>
      <p>{story.excerpt ?? "Sin resumen todavía."}</p>
      <div className={styles.actions}>
        {story.status === "published" ? <Link href={`/revista/${story.slug}`} className={styles.viewLink}>Ver publicación ↗</Link> : <span />}
        {hasActions ? <div className={styles.buttons}>
          {allowed.edit ? <button type="button" className={platform.smallButtonQuiet} disabled={busy} onClick={onEdit}>Editar</button> : null}
          {allowed.submit ? <button type="button" className={platform.smallButtonQuiet} disabled={busy} onClick={onSubmit}>{pending ? "Enviando…" : "Enviar a revisión"}</button> : null}
          {allowed.publish ? <button type="button" className={platform.smallButton} disabled={busy} onClick={onPublish}>{pending ? "Publicando…" : "Publicar"}</button> : null}
          {allowed.draft ? <button type="button" className={platform.smallButtonQuiet} disabled={busy} onClick={onDraft}>Pasar a borrador</button> : null}
          {allowed.archive ? <button type="button" className={platform.smallButtonQuiet} disabled={busy} onClick={onArchive}>Archivar</button> : null}
          {allowed.remove ? <button type="button" className={styles.dangerButton} disabled={busy} onClick={onDelete}>Eliminar</button> : null}
        </div> : null}
      </div>
    </article>
  );
}
