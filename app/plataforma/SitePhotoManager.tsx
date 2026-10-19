"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";

import { compressImage, imagePresets, optimizationNote } from "@/lib/image-compress";
import {
  emptySitePhotoSlots,
  groupSitePhotoSlots,
  MAX_SITE_PHOTO_BYTES,
  SITE_PHOTO_ASPECT_LABELS,
  sitePhotoAssetPath,
  sitePhotoExtension,
  type SitePhotoSlot,
  type SitePhotoSlotKey,
} from "@/lib/site-photos";
import { createClient } from "@/utils/supabase/client";

import {
  getSitePhotoSlotsAction,
  restoreSitePhotoAction,
  updateSitePhotoSlotAction,
  type SitePhotoSlotRecord,
} from "./actions";
import styles from "./site-photo-manager.module.css";

type PhotoDraft = {
  file: File | null;
  altText: string;
  caption: string;
  isPublished: boolean;
};

type PhotoFeedback = { slotKey: SitePhotoSlotKey; message: string; error: boolean };

function formatUpdatedAt(value: string) {
  return `Último cambio: ${new Intl.DateTimeFormat("es-DO", {
    dateStyle: "short", timeStyle: "short", timeZone: "America/Santo_Domingo",
  }).format(new Date(value))}`;
}

function mergeSlots(records: SitePhotoSlotRecord[]): SitePhotoSlot[] {
  const recordsByKey = new Map(records.map((record) => [record.key, record]));
  return emptySitePhotoSlots().map((slot) => ({ ...slot, ...recordsByKey.get(slot.key) }));
}

function SitePhotoCard({ slot, busy, feedback, onSave, onRestore }: {
  slot: SitePhotoSlot;
  busy: boolean;
  feedback: PhotoFeedback | null;
  onSave: (slot: SitePhotoSlot, draft: PhotoDraft) => Promise<void>;
  onRestore: (slot: SitePhotoSlot) => Promise<void>;
}) {
  const hasCustom = Boolean(slot.imagePath);
  const initialPublished = hasCustom ? slot.isPublished : true;
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [fileVersion, setFileVersion] = useState(0);
  const [fileError, setFileError] = useState("");
  const [altText, setAltText] = useState(slot.altText);
  const [caption, setCaption] = useState(slot.caption ?? "");
  const [isPublished, setIsPublished] = useState(initialPublished);
  const [optimizing, setOptimizing] = useState(false);
  const [optimizedNote, setOptimizedNote] = useState("");
  const objectUrl = useRef<string | null>(null);
  // Every new selection or clear bumps this counter, so a slow optimization that finishes late is discarded.
  const selectionVersion = useRef(0);

  const hasPhoto = Boolean(file || hasCustom);
  const shownLive = hasCustom && slot.isPublished;
  const changed = Boolean(
    file ||
    altText !== slot.altText ||
    caption !== (slot.caption ?? "") ||
    isPublished !== initialPublished,
  );
  const canSave = changed && hasPhoto && !optimizing;
  const thumbSrc = previewUrl ?? (hasCustom ? slot.imageUrl : null) ?? slot.defaultImage;
  const thumbIsRemote = Boolean(previewUrl) || hasCustom;
  const thumbAlt = previewUrl
    ? altText || `Vista previa de ${slot.title}`
    : hasCustom ? slot.altText : slot.defaultAlt;
  const stateText = shownLive
    ? "La web muestra esta foto."
    : hasCustom
      ? "Borrador: la web sigue mostrando la imagen original hasta que la publiques."
      : "La web muestra la imagen original del sitio.";

  useEffect(() => () => {
    selectionVersion.current += 1;
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
  }, []);

  function clearSelection() {
    selectionVersion.current += 1;
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = null;
    setFile(null);
    setPreviewUrl(null);
    setFileError("");
    setOptimizing(false);
    setOptimizedNote("");
    setFileVersion((value) => value + 1);
  }

  async function choosePhoto(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.currentTarget.files?.[0];
    if (!selected) return;
    clearSelection();
    const version = selectionVersion.current;
    setOptimizing(true);
    try {
      const optimized = await compressImage(selected, { ...imagePresets.sitePhoto, fileName: selected.name });
      if (version !== selectionVersion.current) return;
      if (optimized.file.size > MAX_SITE_PHOTO_BYTES) {
        throw new Error("La fotografía optimizada sigue superando 10 MB. Prueba con otra imagen.");
      }
      objectUrl.current = URL.createObjectURL(optimized.file);
      setFile(optimized.file);
      setPreviewUrl(objectUrl.current);
      setOptimizedNote(optimizationNote(optimized) ?? "");
    } catch (error) {
      if (version === selectionVersion.current) {
        clearSelection();
        setFileError(error instanceof Error ? error.message : "No pudimos preparar esta foto. Inténtalo de nuevo.");
      }
    } finally {
      if (version === selectionVersion.current) setOptimizing(false);
    }
  }

  function discardChanges() {
    clearSelection();
    setAltText(slot.altText);
    setCaption(slot.caption ?? "");
    setIsPublished(initialPublished);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void onSave(slot, { file, altText, caption, isPublished });
  }

  return (
    <article className={styles.card} aria-labelledby={`site-photo-${slot.key}`}>
      <div className={styles.thumb} data-aspect={slot.aspect}>
        {thumbSrc ? (
          <Image src={thumbSrc} alt={thumbAlt} fill sizes="(max-width: 760px) 100vw, 33vw" unoptimized={thumbIsRemote} />
        ) : null}
        <span className={styles.badge} data-custom={String(hasCustom)}>{hasCustom ? "Foto subida" : "Original del sitio"}</span>
        {previewUrl ? <span className={styles.previewBadge}>Vista previa · sin guardar</span> : null}
      </div>

      <div className={styles.body}>
        <div className={styles.titleRow}>
          <h4 id={`site-photo-${slot.key}`}>{slot.title}</h4>
          <a className={styles.link} href={slot.pageHref} target="_blank" rel="noreferrer">Ver en la web ↗</a>
        </div>
        <p className={styles.where}>{slot.where}</p>
        <p className={styles.aspect}>{SITE_PHOTO_ASPECT_LABELS[slot.aspect]}</p>
        <p className={styles.state} data-live={String(shownLive)}>
          <strong>{stateText}</strong>
          {slot.updatedAt ? <span>{formatUpdatedAt(slot.updatedAt)}</span> : null}
        </p>

        {feedback ? <p className={feedback.error ? styles.error : styles.success} role={feedback.error ? "alert" : "status"}>{feedback.message}</p> : null}

        <form className={styles.form} onSubmit={submit}>
          <fieldset className={styles.fieldset} disabled={busy || optimizing}>
            <label className={styles.field}>
              {hasCustom ? "Reemplazar fotografía" : "Subir fotografía"}
              <input key={fileVersion} name="photo" type="file" accept="image/jpeg,image/png,image/webp" onChange={choosePhoto} />
              <small>JPG, PNG o WebP. Puedes subir fotos grandes; el sistema las optimiza automáticamente. Verás la vista previa antes de guardar.</small>
            </label>
            {optimizing ? <p className={styles.loading} role="status">Optimizando foto…</p> : null}
            {fileError ? <p className={styles.error} role="alert">{fileError}</p> : null}
            {file ? <div className={styles.selection}><span>{file.name}</span><button type="button" onClick={clearSelection}>Quitar selección</button></div> : null}
            {file && optimizedNote ? <p className={styles.where} role="status">{optimizedNote}</p> : null}

            <label className={styles.field}>
              Descripción de la foto <span>(texto alternativo)</span>
              <input name="altText" required={hasPhoto} maxLength={250} value={altText} onChange={(event) => setAltText(event.target.value)} placeholder="Ej.: socios entregando útiles escolares" />
              <small>Describe lo que aparece para quien usa un lector de pantalla.</small>
            </label>

            {slot.hasCaption ? (
              <label className={styles.field}>
                Pie de foto <span>(opcional)</span>
                <input name="caption" maxLength={300} value={caption} onChange={(event) => setCaption(event.target.value)} placeholder="Lugar, fecha o nombre de la actividad" />
                <small>Se muestra debajo de la foto en la página pública.</small>
              </label>
            ) : null}

            <label className={styles.publish}>
              <input name="isPublished" type="checkbox" checked={hasPhoto && isPublished} disabled={!hasPhoto} onChange={(event) => setIsPublished(event.target.checked)} />
              <span>
                <strong>Publicar en la web</strong>
                <small>{hasPhoto && isPublished ? "Al guardar, la web mostrará esta foto." : "Al guardar, la foto queda en borrador y la web sigue mostrando la original."}</small>
              </span>
            </label>

            <div className={styles.actions}>
              <button className={styles.save} type="submit" disabled={!canSave}>
                {busy ? "Guardando…" : hasPhoto && isPublished ? "Guardar y publicar" : "Guardar borrador"}
              </button>
              <button className={styles.quietButton} type="button" disabled={!changed} onClick={discardChanges}>Descartar cambios</button>
            </div>
          </fieldset>
        </form>

        {hasCustom ? (
          <button className={styles.restore} type="button" disabled={busy} onClick={() => void onRestore(slot)}>
            Restaurar la original
          </button>
        ) : null}
      </div>
    </article>
  );
}

export function SitePhotoManager({ onOpenMagazine }: { onOpenMagazine?: () => void }) {
  const router = useRouter();
  const [slots, setSlots] = useState<SitePhotoSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [busySlot, setBusySlot] = useState<SitePhotoSlotKey | null>(null);
  const [feedback, setFeedback] = useState<PhotoFeedback | null>(null);

  useEffect(() => {
    let active = true;
    void getSitePhotoSlotsAction()
      .then((result) => {
        if (!active) return;
        setSlots(result.ok ? mergeSlots(result.slots) : []);
        setLoadError(result.ok ? "" : result.message);
      })
      .catch(() => {
        if (active) setLoadError("No se pudieron cargar las fotos. Revisa tu conexión e inténtalo de nuevo.");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [loadAttempt]);

  async function refreshSlots() {
    try {
      const refreshed = await getSitePhotoSlotsAction();
      if (refreshed.ok) setSlots(mergeSlots(refreshed.slots));
    } catch { /* The confirmed change is already shown in the card. */ }
  }

  async function saveSlot(slot: SitePhotoSlot, draft: PhotoDraft) {
    if (busySlot) return;
    const altText = draft.altText.trim();
    const hasPhoto = Boolean(draft.file || slot.imagePath);
    if (hasPhoto && !altText) {
      setFeedback({ slotKey: slot.key, message: "Escribe una descripción de lo que aparece en la fotografía.", error: true });
      return;
    }

    setBusySlot(slot.key);
    setFeedback(null);
    let uploadedPath: string | null = null;
    let saved = false;
    const supabase = createClient();

    async function discardUpload() {
      if (!uploadedPath || saved) return;
      try { await supabase.storage.from("club-public").remove([uploadedPath]); } catch { /* Keep the original save error visible. */ }
    }

    try {
      if (draft.file) {
        const extension = sitePhotoExtension(draft.file.type);
        if (!extension || draft.file.size > MAX_SITE_PHOTO_BYTES) {
          throw new Error("Usa una fotografía JPG, PNG o WebP de 10 MB o menos.");
        }
        uploadedPath = sitePhotoAssetPath(slot.key, crypto.randomUUID(), extension);
        const { error } = await supabase.storage.from("club-public").upload(uploadedPath, draft.file, {
          cacheControl: "3600", contentType: draft.file.type, upsert: false,
        });
        if (error) throw new Error("No se pudo subir la fotografía. Revisa tu conexión y vuelve a guardar.");
      }

      const imagePath = uploadedPath ?? slot.imagePath;
      const result = await updateSitePhotoSlotAction({
        slotKey: slot.key,
        imagePath,
        altText: imagePath ? altText : "",
        caption: imagePath && slot.hasCaption ? draft.caption.trim() || null : null,
        isPublished: Boolean(imagePath && draft.isPublished),
      });
      if (!result.ok) {
        await discardUpload();
        setFeedback({ slotKey: slot.key, message: result.message, error: true });
        return;
      }

      saved = true;
      setFeedback({ slotKey: slot.key, message: result.message, error: false });
      await refreshSlots();
      router.refresh();
    } catch (error) {
      await discardUpload();
      setFeedback({
        slotKey: slot.key,
        message: error instanceof Error ? error.message : "No se pudo guardar la fotografía. Inténtalo de nuevo.",
        error: true,
      });
    } finally {
      setBusySlot(null);
    }
  }

  async function restoreSlot(slot: SitePhotoSlot) {
    if (busySlot) return;
    if (!window.confirm(`¿Restaurar la imagen original de «${slot.title}»? La foto subida se borrará y la web volverá a mostrar la original.`)) return;

    setBusySlot(slot.key);
    setFeedback(null);
    try {
      const result = await restoreSitePhotoAction(slot.key);
      setFeedback({ slotKey: slot.key, message: result.message, error: !result.ok });
      if (result.ok) {
        await refreshSlots();
        router.refresh();
      }
    } catch {
      setFeedback({ slotKey: slot.key, message: "No se pudo restaurar la imagen original. Inténtalo de nuevo.", error: true });
    } finally {
      setBusySlot(null);
    }
  }

  const groups = groupSitePhotoSlots(slots);

  return (
    <section className={styles.manager} aria-label="Fotos de la web">
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Gestión del contenido público</p>
          <h2>Fotos de la web</h2>
          <p>Cada tarjeta muestra la imagen que ve el público. Sube una foto para reemplazarla o restaura la original cuando quieras.</p>
        </div>
        <p className={styles.privacyNote}>Publica fotos aprobadas para uso público y con autorización de las personas que aparecen.</p>
      </header>

      {onOpenMagazine ? (
        <div className={styles.magazineNote}>
          <p>Las fotos de cada publicación de la Revista se eligen dentro de la publicación.</p>
          <button type="button" onClick={onOpenMagazine}>Gestionar publicaciones →</button>
        </div>
      ) : null}

      {loadError ? (
        <div className={styles.loadError}>
          <p className={styles.error} role="alert">{loadError}</p>
          <button className={styles.quietButton} type="button" disabled={loading} onClick={() => { setLoading(true); setLoadError(""); setLoadAttempt((value) => value + 1); }}>
            Volver a cargar
          </button>
        </div>
      ) : null}
      {loading ? <p className={styles.loading} role="status">Cargando las fotos de la web…</p> : null}

      {!loading && !loadError ? groups.map((group) => (
        <section className={styles.group} key={group.section} aria-labelledby={`site-photo-group-${group.section}`}>
          <div className={styles.groupHeading}>
            <div>
              <h3 id={`site-photo-group-${group.section}`}>{group.label}</h3>
              <p>{group.hint}</p>
            </div>
            <span>{group.slots.length === 1 ? "1 foto" : `${group.slots.length} fotos`}</span>
          </div>
          <div className={styles.grid}>
            {group.slots.map((slot) => (
              <SitePhotoCard
                key={`${slot.key}-${slot.imagePath ?? "original"}-${slot.updatedAt ?? "initial"}`}
                slot={slot}
                busy={busySlot !== null}
                feedback={feedback?.slotKey === slot.key ? feedback : null}
                onSave={saveSlot}
                onRestore={restoreSlot}
              />
            ))}
          </div>
        </section>
      )) : null}

      <details className={styles.otherAssets}>
        <summary>Logo del club</summary>
        <p>El logo es la identidad fija del club: aparece en la cabecera, el pie de la web y la plataforma. No se reemplaza desde este módulo.</p>
        <span className={styles.logoPreview}>
          <Image src="/club-santo-domingo-colonial-logo.png" alt="Logo del Club Rotario Santo Domingo Colonial" fill sizes="280px" />
        </span>
      </details>
    </section>
  );
}
