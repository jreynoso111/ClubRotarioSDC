"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import type { FormEvent, MouseEvent } from "react";

import { editorialLayouts, serializeEditorialContent, type EditorialLayoutId } from "@/lib/editorial-content";
import { createClient } from "@/utils/supabase/client";

import { createStoryAction } from "./actions";
import styles from "./platform.module.css";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function imageExtension(file: File) {
  return file.type === "image/jpeg" ? "jpg" : file.type === "image/png" ? "png" : "webp";
}

async function uploadStoryImage(file: File | null, slot: "cover" | "inline") {
  if (!file) return null;
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) throw new Error("Usa una imagen JPG, PNG o WebP.");
  if (file.size > MAX_IMAGE_BYTES) throw new Error("Cada imagen debe pesar 10 MB o menos.");

  const path = `stories/${crypto.randomUUID()}-${slot}.${imageExtension(file)}`;
  const { error } = await createClient().storage.from("club-public").upload(path, file, {
    cacheControl: "3600",
    contentType: file.type,
    upsert: false,
  });
  if (error) throw new Error("No se pudo subir la imagen. Revisa tu conexión y los permisos de edición.");
  return path;
}

export function StoryComposerDialog({ canPublish }: { canPublish: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [layoutId, setLayoutId] = useState<EditorialLayoutId>("portada");
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState("");
  const [feedbackError, setFeedbackError] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  function closeDialog() {
    if (pending) return;
    setOpen(false);
    setFeedback("");
    setFeedbackError(false);
  }

  function handleBackdropClick(event: MouseEvent<HTMLDialogElement>) {
    if (event.target === dialogRef.current) closeDialog();
  }

  function submitStory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const title = String(data.get("title") ?? "").trim();
    const excerpt = String(data.get("excerpt") ?? "").trim();
    const body = String(data.get("body") ?? "").trim();
    const pullQuote = String(data.get("pullQuote") ?? "").trim();
    const coverFile = data.get("coverImage") instanceof File && (data.get("coverImage") as File).size > 0
      ? data.get("coverImage") as File
      : null;
    const inlineFile = data.get("inlineImage") instanceof File && (data.get("inlineImage") as File).size > 0
      ? data.get("inlineImage") as File
      : null;
    const inlineImageAlt = String(data.get("inlineImageAlt") ?? "").trim();
    if (inlineFile && !inlineImageAlt) {
      setFeedback("Describe la imagen de apoyo para que también sea accesible.");
      setFeedbackError(true);
      return;
    }
    if (coverFile && (!ALLOWED_IMAGE_TYPES.has(coverFile.type) || coverFile.size > MAX_IMAGE_BYTES)) {
      setFeedback("La imagen principal debe ser JPG, PNG o WebP y pesar 10 MB o menos.");
      setFeedbackError(true);
      return;
    }
    if (inlineFile && (!ALLOWED_IMAGE_TYPES.has(inlineFile.type) || inlineFile.size > MAX_IMAGE_BYTES)) {
      setFeedback("La imagen de apoyo debe ser JPG, PNG o WebP y pesar 10 MB o menos.");
      setFeedbackError(true);
      return;
    }

    const status = data.get("status") === "published" && canPublish ? "published" : "draft";
    const storyType = String(data.get("storyType") ?? "cronica");
    const contentBase = {
      layoutId,
      body,
      pullQuote,
      inlineImagePath: null,
      inlineImageAlt,
      inlineImageCaption: String(data.get("inlineImageCaption") ?? "").trim(),
      coverImageAlt: String(data.get("coverImageAlt") ?? "").trim() || title,
    } as const;

    setFeedback("");
    setFeedbackError(false);
    startTransition(async () => {
      const uploadedPaths: string[] = [];
      try {
        const coverImagePath = await uploadStoryImage(coverFile, "cover");
        if (coverImagePath) uploadedPaths.push(coverImagePath);
        const inlineImagePath = await uploadStoryImage(inlineFile, "inline");
        if (inlineImagePath) uploadedPaths.push(inlineImagePath);
        const content = serializeEditorialContent({ ...contentBase, inlineImagePath });
        if (content.length > 20_000) throw new Error("El texto supera el máximo permitido. Reduce el contenido y vuelve a intentar.");

        const result = await createStoryAction({
          title,
          excerpt,
          content,
          storyType,
          status,
          isPublic: status === "published",
          coverImagePath: coverImagePath ?? "",
        });
        if (!result.ok) {
          if (uploadedPaths.length) await createClient().storage.from("club-public").remove(uploadedPaths);
          setFeedback(result.message);
          setFeedbackError(true);
          return;
        }

        formRef.current?.reset();
        setLayoutId("portada");
        setOpen(false);
        setFeedback(status === "published" ? "La publicación ya está en la revista." : "El borrador quedó guardado.");
        setFeedbackError(false);
        router.refresh();
      } catch (error) {
        if (uploadedPaths.length) await createClient().storage.from("club-public").remove(uploadedPaths);
        setFeedback(error instanceof Error ? error.message : "No se pudo guardar la publicación.");
        setFeedbackError(true);
      }
    });
  }

  return (
    <>
      <article className={styles.storyComposeCard}>
        <p className={styles.cardLabel}>Estudio editorial</p>
        <h2 className={styles.cardTitle}>Una historia lista para tomar forma.</h2>
        <p>Elige una composición, agrega texto e imágenes y guarda el artículo como borrador o publicación.</p>
        <button className={styles.button} type="button" onClick={() => { setFeedback(""); setOpen(true); }}>
          Nueva publicación
        </button>
        {feedback ? <p className={feedbackError ? styles.feedbackError : styles.feedbackSuccess} role={feedbackError ? "alert" : "status"}>{feedback}</p> : null}
      </article>

      <dialog
        ref={dialogRef}
        className={styles.storyDialog}
        aria-labelledby="story-composer-title"
        onClick={handleBackdropClick}
        onCancel={(event) => { if (pending) event.preventDefault(); else setOpen(false); }}
        onClose={() => { if (!pending) setOpen(false); }}
      >
        <div className={styles.storyDialogHeader}>
          <div><p className={styles.cardLabel}>Nueva publicación</p><h2 id="story-composer-title">Dale forma a la historia.</h2></div>
          <button type="button" className={styles.storyDialogClose} onClick={closeDialog} disabled={pending} aria-label="Cerrar formulario">×</button>
        </div>
        <form ref={formRef} className={styles.storyComposerForm} onSubmit={submitStory}>
          <fieldset className={styles.layoutFieldset}>
            <legend>1. Elige un formato editorial</legend>
            <p>La plantilla fija la ubicación de titulares, fotografías, citas y texto.</p>
            <div className={styles.layoutChoices}>
              {editorialLayouts.map((layout) => (
                <label className={`${styles.layoutChoice} ${layoutId === layout.id ? styles.layoutChoiceActive : ""}`} key={layout.id}>
                  <input type="radio" name="layoutId" value={layout.id} checked={layoutId === layout.id} onChange={() => setLayoutId(layout.id)} />
                  <span className={styles.layoutWireframe} aria-hidden="true">
                    {layout.map.map((slot) => <span key={slot}>{slot}</span>)}
                  </span>
                  <strong>{layout.name}</strong>
                  <small>{layout.description}</small>
                </label>
              ))}
            </div>
          </fieldset>

          <div className={styles.storyFormGrid}>
            <label>Título<input name="title" required minLength={3} maxLength={180} placeholder="El titular de la historia" /></label>
            <label>Sección<select name="storyType" defaultValue="cronica"><option value="cronica">Crónica</option><option value="voces">Voces del club</option><option value="archivo">Archivo</option><option value="noticia">Noticia</option></select></label>
            <label className={styles.storyFormWide}>Bajada<textarea name="excerpt" required minLength={10} maxLength={1000} placeholder="Una frase que invite a leer y dé contexto." /></label>
            <label className={styles.storyFormWide}>Texto de la historia<textarea name="body" required minLength={30} maxLength={18000} placeholder="Separa los párrafos con una línea en blanco. Escribe con hechos, contexto y voces verificadas." /></label>
            <label className={styles.storyFormWide}>Cita destacada <span className={styles.storyFieldHint}>Opcional; la plantilla la ubicará dentro de la lectura.</span><textarea name="pullQuote" maxLength={500} placeholder="Una frase breve que capture el sentido de la historia." /></label>
          </div>

          <fieldset className={styles.imageFieldset}>
            <legend>2. Añade las imágenes</legend>
            <p>Las imágenes se guardan en el archivo público del club. JPG, PNG o WebP, hasta 10 MB cada una.</p>
            <div className={styles.storyFormGrid}>
              <label>Fotografía principal<input name="coverImage" type="file" accept="image/jpeg,image/png,image/webp" /><span className={styles.storyFieldHint}>Aparece como imagen de portada. Es opcional.</span></label>
              <label>Descripción accesible<input name="coverImageAlt" maxLength={250} placeholder="Ej. Voluntarios preparando materiales" /><span className={styles.storyFieldHint}>Si queda vacío, usaremos el título.</span></label>
              <label>Fotografía de apoyo<input name="inlineImage" type="file" accept="image/jpeg,image/png,image/webp" /><span className={styles.storyFieldHint}>La plantilla decide en qué parte aparece.</span></label>
              <label>Descripción de la foto de apoyo<input name="inlineImageAlt" maxLength={250} placeholder="Qué se ve en la fotografía" /></label>
              <label className={styles.storyFormWide}>Pie de foto<input name="inlineImageCaption" maxLength={300} placeholder="Nombre, lugar o contexto de la imagen" /></label>
            </div>
          </fieldset>

          <div className={styles.storyPublishRow}>
            <label>Estado<select name="status" defaultValue="draft"><option value="draft">Guardar como borrador</option>{canPublish ? <option value="published">Publicar en la revista</option> : null}</select></label>
            <p>Los borradores solo los ve el equipo editorial. Las publicaciones quedan visibles en el sitio.</p>
          </div>
          {feedback && open ? <p className={styles.feedbackError} role="alert">{feedback}</p> : null}
          <div className={styles.storyDialogActions}>
            <button type="button" className={styles.buttonQuiet} onClick={closeDialog} disabled={pending}>Cancelar</button>
            <button type="submit" className={styles.button} disabled={pending}>{pending ? "Guardando…" : "Guardar publicación"}</button>
          </div>
        </form>
      </dialog>
    </>
  );
}
