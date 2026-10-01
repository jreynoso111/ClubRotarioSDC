"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import type { ChangeEvent, FormEvent } from "react";

import { editorialLayouts, MAX_EDITORIAL_CONTENT_LENGTH, MAX_EDITORIAL_GALLERY_IMAGES, parseEditorialContent, serializeEditorialContent, splitEditorialParagraphs, type EditorialImageAlignment, type EditorialLayoutId } from "@/lib/editorial-content";
import { PublicationArticle, PublicationAside } from "@/components/public/PublicationArticle";
import type { PlatformStory } from "@/lib/platform";
import { createClient } from "@/utils/supabase/client";

import { createStoryAction } from "./actions";
import editor from "./story-composer.module.css";
import styles from "./platform.module.css";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const storyTypeLabels: Record<string, string> = { cronica: "Crónica", voces: "Voces del club", archivo: "Archivo", noticia: "Noticia", otro: "Historia" };

type Draft = {
  title: string; excerpt: string; body: string; pullQuote: string; storyType: string;
  status: "draft" | "published"; coverImageAlt: string; inlineImageAlt: string; inlineImageCaption: string;
  inlineImageAfterParagraph: string; inlineImageAlignment: EditorialImageAlignment;
};
type SelectedImage = { file: File; url: string };
type GalleryDraftImage = { id: string; path: string | null; url: string; alt: string; caption: string; file?: File };

function draftFromStory(story?: PlatformStory): Draft {
  const content = story ? parseEditorialContent(story.content) : null;
  return {
    title: story?.title ?? "", excerpt: story?.excerpt ?? "", body: content?.body ?? story?.content ?? "",
    pullQuote: content?.pullQuote ?? "", storyType: story?.storyType ?? "cronica",
    status: story?.status === "published" ? "published" : "draft", coverImageAlt: content?.coverImageAlt ?? "",
    inlineImageAlt: content?.inlineImageAlt ?? "", inlineImageCaption: content?.inlineImageCaption ?? "",
    inlineImageAfterParagraph: String(content?.inlineImageAfterParagraph ?? 0), inlineImageAlignment: content?.inlineImageAlignment ?? "right",
  };
}

function publicImageUrl(path: string | null | undefined) {
  if (!path) return undefined;
  if (path.startsWith("/") || path.startsWith("https://")) return path;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return base ? `${base.replace(/\/$/, "")}/storage/v1/object/public/club-public/${path}` : undefined;
}

async function uploadStoryImage(file: File | null, slot: "cover" | "inline" | "gallery") {
  if (!file) return null;
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) throw new Error("Usa una imagen JPG, PNG o WebP.");
  if (file.size > MAX_IMAGE_BYTES) throw new Error("Cada imagen debe pesar 10 MB o menos.");
  const extension = file.type === "image/jpeg" ? "jpg" : file.type === "image/png" ? "png" : "webp";
  const path = `stories/${crypto.randomUUID()}-${slot}.${extension}`;
  const { error } = await createClient().storage.from("club-public").upload(path, file, {
    cacheControl: "3600", contentType: file.type, upsert: false,
  });
  if (error) throw new Error("No se pudo subir la imagen. Revisa tu conexión y los permisos de edición.");
  return path;
}

function PublicationPreview({ draft, layoutId, coverUrl, inlineUrl, gallery }: { draft: Draft; layoutId: EditorialLayoutId; coverUrl?: string; inlineUrl?: string; gallery: GalleryDraftImage[] }) {
  return (
    <div className={editor.previewPage}>
      <div className={editor.previewMasthead}><span>Revista del club</span><span>Vista previa de tu publicación</span></div>
      <PublicationArticle className={editor.previewArticle}
        title={draft.title.trim() || "El título de tu publicación"}
        excerpt={draft.excerpt.trim() || "Aquí verás el resumen que presenta la publicación e invita a leerla en la revista."}
        label={storyTypeLabels[draft.storyType] ?? "Historia"} byline="Publicado por el club" date={<span>Vista previa</span>}
        editorial={{ layoutId, body: draft.body.trim() || "El texto de tu publicación aparecerá aquí. Separa los párrafos con una línea en blanco y acompáñalos con tus fotografías.", pullQuote: draft.pullQuote.trim(), coverImageAlt: draft.coverImageAlt || draft.title,
          inlineImagePath: null, inlineImageAlt: draft.inlineImageAlt, inlineImageCaption: draft.inlineImageCaption,
          inlineImageAfterParagraph: Number(draft.inlineImageAfterParagraph), inlineImageAlignment: draft.inlineImageAlignment, gallery: [] }}
        coverSrc={coverUrl} inlineSrc={inlineUrl}
        galleryImages={gallery.map((image) => ({ src: image.url, alt: image.alt || "Fotografía de la galería", caption: image.caption }))}
        aside={<PublicationAside />} />
    </div>
  );
}

export function StoryComposerDialog({ canPublish, story }: { canPublish: boolean; story?: PlatformStory }) {
  const router = useRouter();
  const titleId = useId();
  const layoutsId = useId();
  const originalContent = story ? parseEditorialContent(story.content) : null;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => draftFromStory(story));
  const [layoutId, setLayoutId] = useState<EditorialLayoutId>(() => originalContent?.layoutId ?? "portada");
  const [layoutsExpanded, setLayoutsExpanded] = useState(false);
  const [coverImage, setCoverImage] = useState<SelectedImage | null>(null);
  const [inlineImage, setInlineImage] = useState<SelectedImage | null>(null);
  const [savedAssets, setSavedAssets] = useState(() => ({ cover: story?.coverImagePath ?? null, inline: originalContent?.inlineImagePath ?? null }));
  const [gallery, setGallery] = useState<GalleryDraftImage[]>(() => (originalContent?.gallery ?? []).map((image) => ({ ...image, id: image.path, url: publicImageUrl(image.path) ?? "" })));
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState("");
  const [feedbackError, setFeedbackError] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const inlineInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const objectUrls = useRef(new Set<string>());
  const selectedLayout = editorialLayouts.find((layout) => layout.id === layoutId)!;
  const coverPath = savedAssets.cover;
  const inlinePath = savedAssets.inline;
  const coverUrl = coverImage?.url ?? publicImageUrl(coverPath);
  const inlineUrl = inlineImage?.url ?? publicImageUrl(inlinePath);
  const paragraphs = splitEditorialParagraphs(draft.body);
  const inlinePosition = Math.min(Number(draft.inlineImageAfterParagraph), paragraphs.length);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    const urls = objectUrls.current;
    return () => { for (const url of urls) URL.revokeObjectURL(url); };
  }, []);

  function closeDialog() {
    if (pending) return;
    setOpen(false);
    setFeedback("");
    setFeedbackError(false);
  }

  function changeField(field: keyof Draft, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function chooseImage(event: ChangeEvent<HTMLInputElement>, slot: "cover" | "inline") {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    if (!ALLOWED_IMAGE_TYPES.has(file.type) || file.size > MAX_IMAGE_BYTES) {
      setFeedback("Cada fotografía debe ser JPG, PNG o WebP y pesar 10 MB o menos.");
      setFeedbackError(true);
      event.currentTarget.value = "";
      return;
    }
    const previous = slot === "cover" ? coverImage : inlineImage;
    if (previous) { URL.revokeObjectURL(previous.url); objectUrls.current.delete(previous.url); }
    const url = URL.createObjectURL(file);
    objectUrls.current.add(url);
    if (slot === "cover") setCoverImage({ file, url });
    else setInlineImage({ file, url });
    setFeedback("");
  }

  function removeImage(slot: "cover" | "inline") {
    const selected = slot === "cover" ? coverImage : inlineImage;
    if (selected) { URL.revokeObjectURL(selected.url); objectUrls.current.delete(selected.url); }
    setSavedAssets((current) => ({ ...current, [slot]: null }));
    if (slot === "cover") { setCoverImage(null); if (coverInputRef.current) coverInputRef.current.value = ""; }
    else { setInlineImage(null); if (inlineInputRef.current) inlineInputRef.current.value = ""; }
  }

  function chooseGalleryImages(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.currentTarget.files ?? []);
    if (!files.length) return;
    event.currentTarget.value = "";
    if (gallery.length + files.length > MAX_EDITORIAL_GALLERY_IMAGES) {
      setFeedback(`Puedes añadir hasta ${MAX_EDITORIAL_GALLERY_IMAGES} fotos al carrusel.`);
      setFeedbackError(true);
      return;
    }
    if (files.some((file) => !ALLOWED_IMAGE_TYPES.has(file.type) || file.size > MAX_IMAGE_BYTES)) {
      setFeedback("Cada fotografía debe ser JPG, PNG o WebP y pesar 10 MB o menos.");
      setFeedbackError(true);
      return;
    }
    const selected = files.map((file) => {
      const url = URL.createObjectURL(file);
      objectUrls.current.add(url);
      return { id: crypto.randomUUID(), path: null, file, url, alt: "", caption: "" };
    });
    setGallery((current) => [...current, ...selected]);
    setFeedback("");
  }

  function changeGalleryImage(id: string, field: "alt" | "caption", value: string) {
    setGallery((current) => current.map((image) => image.id === id ? { ...image, [field]: value } : image));
  }

  function removeGalleryImage(id: string) {
    const selected = gallery.find((image) => image.id === id);
    if (selected?.file) { URL.revokeObjectURL(selected.url); objectUrls.current.delete(selected.url); }
    setGallery((current) => current.filter((image) => image.id !== id));
  }

  function moveGalleryImage(id: string, direction: number) {
    setGallery((current) => {
      const from = current.findIndex((image) => image.id === id);
      const to = from + direction;
      if (from < 0 || to < 0 || to >= current.length) return current;
      const reordered = [...current];
      [reordered[from], reordered[to]] = [reordered[to], reordered[from]];
      return reordered;
    });
  }

  function submitStory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    if ((inlineImage || inlinePath) && !draft.inlineImageAlt.trim()) {
      setFeedback("Describe la fotografía de apoyo para que también sea accesible.");
      setFeedbackError(true);
      return;
    }
    if (gallery.some((image) => !image.alt.trim())) {
      setFeedback("Describe cada fotografía del carrusel antes de guardar.");
      setFeedbackError(true);
      return;
    }
    const status = draft.status === "published" && canPublish ? "published" : "draft";
    setFeedback("");
    setFeedbackError(false);
    startTransition(async () => {
      const uploadedPaths: string[] = [];
      try {
        const coverImagePath = await uploadStoryImage(coverImage?.file ?? null, "cover");
        if (coverImagePath) uploadedPaths.push(coverImagePath);
        const inlineImagePath = await uploadStoryImage(inlineImage?.file ?? null, "inline");
        if (inlineImagePath) uploadedPaths.push(inlineImagePath);
        const savedGallery: GalleryDraftImage[] = [];
        for (const image of gallery) {
          const path = await uploadStoryImage(image.file ?? null, "gallery") ?? image.path;
          if (!path) throw new Error("No se pudo guardar una fotografía del carrusel.");
          if (image.file) uploadedPaths.push(path);
          savedGallery.push({ id: path, path, url: publicImageUrl(path) ?? "", alt: image.alt.trim(), caption: image.caption.trim() });
        }
        const content = serializeEditorialContent({
          layoutId, body: draft.body, pullQuote: draft.pullQuote,
          inlineImagePath: inlineImagePath ?? inlinePath ?? null,
          inlineImageAlt: draft.inlineImageAlt, inlineImageCaption: draft.inlineImageCaption,
          inlineImageAfterParagraph: inlinePosition, inlineImageAlignment: draft.inlineImageAlignment,
          gallery: savedGallery.map((image) => ({ path: image.path!, alt: image.alt, caption: image.caption })),
          coverImageAlt: draft.coverImageAlt.trim() || draft.title.trim(),
        });
        if (content.length > MAX_EDITORIAL_CONTENT_LENGTH) throw new Error("El texto supera el máximo permitido. Reduce el contenido y vuelve a intentar.");
        const result = await createStoryAction({
          storyId: story?.id, title: draft.title, excerpt: draft.excerpt, content,
          storyType: draft.storyType, status, isPublic: status === "published",
          coverImagePath: coverImagePath ?? coverPath ?? "",
        });
        if (!result.ok) {
          if (uploadedPaths.length) await createClient().storage.from("club-public").remove(uploadedPaths);
          setFeedback(result.message);
          setFeedbackError(true);
          return;
        }
        // Once saved, these images belong to the article; later UI errors must not remove them.
        uploadedPaths.length = 0;
        for (const url of objectUrls.current) URL.revokeObjectURL(url);
        objectUrls.current.clear();
        setCoverImage(null);
        setInlineImage(null);
        setSavedAssets({ cover: coverImagePath ?? coverPath ?? null, inline: inlineImagePath ?? inlinePath ?? null });
        setGallery(savedGallery);
        if (coverInputRef.current) coverInputRef.current.value = "";
        if (inlineInputRef.current) inlineInputRef.current.value = "";
        if (galleryInputRef.current) galleryInputRef.current.value = "";
        if (!story) { setDraft(draftFromStory()); setLayoutId("portada"); setSavedAssets({ cover: null, inline: null }); setGallery([]); }
        setLayoutsExpanded(false);
        setOpen(false);
        setFeedback(story ? "Los cambios de la publicación quedaron guardados." : status === "published" ? "La publicación ya está en la revista." : "El borrador quedó guardado.");
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
      {story ? <span className={editor.editTrigger}><button className={styles.smallButtonQuiet} type="button" onClick={() => { setFeedback(""); setOpen(true); }}>Editar publicación</button>{feedback && !open ? <span className={styles.feedbackSuccess} role="status">{feedback}</span> : null}</span> : (
        <article className={editor.composeCard}>
          <div><p className={styles.cardLabel}>Gestionar la revista</p><h2 className={styles.cardTitle}>Publicaciones del club</h2><p>Escribe el contenido, añade sus fotografías y revisa el diseño antes de guardarlo.</p></div>
          <button className={editor.newButton} type="button" onClick={() => { setFeedback(""); setOpen(true); }}><span aria-hidden="true">＋</span> Nueva publicación</button>
          {feedback ? <p className={feedbackError ? styles.feedbackError : styles.feedbackSuccess} role={feedbackError ? "alert" : "status"}>{feedback}</p> : null}
        </article>
      )}

      <dialog ref={dialogRef} className={editor.dialog} aria-labelledby={titleId}
        onCancel={(event) => { event.preventDefault(); event.stopPropagation(); }}
        onClose={() => { if (!pending) setOpen(false); }}>
        <div className={editor.dialogHeader}>
          <div><p className={styles.cardLabel}>{story ? "Editar publicación" : "Nueva publicación"} · Revista</p><h2 id={titleId}>{story ? "Editar el contenido y su diseño" : "Preparar una publicación"}</h2><p>Completa el texto y las fotos. Al final podrás elegir el diseño y ver cómo quedará.</p></div>
          <button type="button" className={editor.closeButton} onClick={closeDialog} disabled={pending} aria-label="Cerrar formulario">×</button>
        </div>
        <form className={editor.form} onSubmit={submitStory}>
          <fieldset className={editor.fieldset} disabled={pending}>
            <legend>1. Contenido de la publicación</legend>
            <div className={editor.formGrid}>
              <label>Título<input name="title" required minLength={3} maxLength={180} value={draft.title} onChange={(event) => changeField("title", event.target.value)} placeholder="El título que aparecerá en la revista" /></label>
              <label>Sección de la revista<select name="storyType" value={draft.storyType} onChange={(event) => changeField("storyType", event.target.value)}><option value="cronica">Crónica</option><option value="voces">Voces del club</option><option value="archivo">Archivo</option><option value="noticia">Noticia</option><option value="otro">Otra historia</option></select></label>
              <label className={editor.wide}>Resumen de la publicación<textarea name="excerpt" required minLength={10} maxLength={1000} value={draft.excerpt} onChange={(event) => changeField("excerpt", event.target.value)} placeholder="Presenta la historia en unas pocas frases. Se verá debajo del título y en la lista de publicaciones." /></label>
              <label className={editor.wide}>Texto de la publicación<textarea className={editor.bodyInput} name="body" required minLength={30} maxLength={18000} value={draft.body} onChange={(event) => changeField("body", event.target.value)} placeholder="Escribe la publicación. Separa los párrafos con una línea en blanco." /><span className={editor.hint}>Separa los párrafos con una línea en blanco para facilitar la lectura.</span></label>
              <label className={editor.wide}>Cita destacada <span className={editor.hint}>Opcional · una frase breve para destacar dentro de la publicación.</span><textarea name="pullQuote" maxLength={500} value={draft.pullQuote} onChange={(event) => changeField("pullQuote", event.target.value)} placeholder="Una voz o idea que quieras destacar" /></label>
            </div>
          </fieldset>

          <fieldset className={editor.fieldset} disabled={pending}>
            <legend>2. Fotografías de esta publicación</legend>
            <p className={editor.sectionHelp}>Estas fotos pertenecen a este artículo de la revista. JPG, PNG o WebP, hasta 10 MB cada una.</p>
            <div className={editor.imageGrid}>
              <div className={editor.imageCard}>
                <label>Fotografía principal<input ref={coverInputRef} name="coverImage" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => chooseImage(event, "cover")} /></label>
                <p className={editor.hint}>Aparece en la portada del artículo y en la lista de publicaciones.</p>
                {coverUrl ? <><div className={editor.imageThumbnail} style={{ backgroundImage: `url("${encodeURI(coverUrl).replaceAll('"', "%22")}")` }} role="img" aria-label={draft.coverImageAlt || "Fotografía principal seleccionada"} /><div className={editor.imageCaption}><span>{coverImage?.file.name ?? "Fotografía actual de la publicación"}</span><button type="button" onClick={() => removeImage("cover")}>Quitar foto</button></div></> : <p className={editor.imageEmpty}>No hay una fotografía principal seleccionada.</p>}
                <label>Descripción de la fotografía principal<input name="coverImageAlt" maxLength={250} value={draft.coverImageAlt} onChange={(event) => changeField("coverImageAlt", event.target.value)} placeholder="Describe qué se ve en la imagen" /><span className={editor.hint}>Ayuda a personas que usan lectores de pantalla. Si queda vacío, se utiliza el título.</span></label>
              </div>
              <div className={editor.imageCard}>
                <label>Fotografía dentro del texto<input ref={inlineInputRef} name="inlineImage" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => chooseImage(event, "inline")} /></label>
                <p className={editor.hint}>Elige el párrafo que acompañará y cómo se coloca a su lado.</p>
                {inlineUrl ? <><div className={editor.imageThumbnail} style={{ backgroundImage: `url("${encodeURI(inlineUrl).replaceAll('"', "%22")}")` }} role="img" aria-label={draft.inlineImageAlt || "Fotografía de apoyo seleccionada"} /><div className={editor.imageCaption}><span>{inlineImage?.file.name ?? "Fotografía de apoyo actual"}</span><button type="button" onClick={() => removeImage("inline")}>Quitar foto</button></div></> : <p className={editor.imageEmpty}>No hay una fotografía de apoyo seleccionada.</p>}
                <label>Descripción de la fotografía de apoyo<input name="inlineImageAlt" required={Boolean(inlineImage || inlinePath)} maxLength={250} value={draft.inlineImageAlt} onChange={(event) => changeField("inlineImageAlt", event.target.value)} placeholder="Describe qué se ve en la imagen" /></label>
                <label>Pie de la fotografía de apoyo<input name="inlineImageCaption" maxLength={300} value={draft.inlineImageCaption} onChange={(event) => changeField("inlineImageCaption", event.target.value)} placeholder="Lugar, fecha o contexto de la foto" /></label>
                <label>Ubicación en el texto<select name="inlineImageAfterParagraph" value={inlinePosition} onChange={(event) => changeField("inlineImageAfterParagraph", event.target.value)}>
                  <option value="-1">Posición original del diseño</option>
                  {paragraphs.length ? paragraphs.slice(0, 1000).map((paragraph, index) => <option key={index} value={index}>Junto al párrafo {index + 1}: {paragraph.slice(0, 65)}{paragraph.length > 65 ? "…" : ""}</option>) : <option value="0">Al inicio del texto</option>}
                  {paragraphs.length > 0 ? <option value={paragraphs.length}>Al final del texto</option> : null}
                </select></label>
                <label>Presentación de la foto<select name="inlineImageAlignment" value={draft.inlineImageAlignment} onChange={(event) => changeField("inlineImageAlignment", event.target.value)}><option value="right">Pequeña a la derecha del texto</option><option value="left">Pequeña a la izquierda del texto</option><option value="wide">Ancha entre párrafos</option></select></label>
              </div>
            </div>
          </fieldset>

          <fieldset className={editor.fieldset} disabled={pending}>
            <legend>3. Carrusel de fotografías al final</legend>
            <p className={editor.sectionHelp}>Añade hasta {MAX_EDITORIAL_GALLERY_IMAGES} fotos. Se muestran debajo del texto, en este orden, y el carrusel vuelve a empezar al llegar a la última.</p>
            <label className={editor.galleryUpload}>Añadir fotos al carrusel<input ref={galleryInputRef} name="galleryImages" type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={chooseGalleryImages} disabled={gallery.length >= MAX_EDITORIAL_GALLERY_IMAGES} /></label>
            {gallery.length ? <ol className={editor.galleryList}>
              {gallery.map((image, index) => <li className={editor.galleryItem} key={image.id}>
                <div className={editor.galleryThumbnail} style={{ backgroundImage: `url("${encodeURI(image.url).replaceAll('"', "%22")}")` }} role="img" aria-label={image.alt || `Fotografía ${index + 1} del carrusel`} />
                <div className={editor.galleryFields}>
                  <div className={editor.galleryItemHeading}><strong>Foto {index + 1} de {gallery.length}</strong><span>{image.file?.name ?? "Fotografía guardada"}</span></div>
                  <label>Descripción de la foto {index + 1}<input name={`galleryAlt-${image.id}`} required maxLength={250} value={image.alt} onChange={(event) => changeGalleryImage(image.id, "alt", event.target.value)} placeholder="Describe qué se ve en esta imagen" /></label>
                  <label>Pie de la foto {index + 1} · opcional<input name={`galleryCaption-${image.id}`} maxLength={300} value={image.caption} onChange={(event) => changeGalleryImage(image.id, "caption", event.target.value)} placeholder="Lugar, fecha o contexto" /></label>
                </div>
                <div className={editor.galleryItemActions}>
                  <button type="button" disabled={index === 0} onClick={() => moveGalleryImage(image.id, -1)} aria-label={`Mover foto ${index + 1} antes`}>↑</button>
                  <button type="button" disabled={index === gallery.length - 1} onClick={() => moveGalleryImage(image.id, 1)} aria-label={`Mover foto ${index + 1} después`}>↓</button>
                  <button type="button" onClick={() => removeGalleryImage(image.id)}>Quitar foto {index + 1}</button>
                </div>
              </li>)}
            </ol> : <p className={editor.imageEmpty}>Esta publicación todavía no tiene fotos para el carrusel.</p>}
          </fieldset>

          <fieldset className={editor.fieldset} disabled={pending}>
            <legend>4. Diseño y vista previa para la revista</legend>
            <div className={editor.layoutSummary}><div><strong>Diseño seleccionado: {selectedLayout.name}</strong><p>{selectedLayout.description}</p></div><button className={editor.layoutToggle} type="button" aria-expanded={layoutsExpanded} aria-controls={layoutsId} onClick={() => setLayoutsExpanded((current) => !current)}>{layoutsExpanded ? "Cerrar opciones de diseño" : "Elegir otro diseño"}<span aria-hidden="true">{layoutsExpanded ? "−" : "+"}</span></button></div>
            <div id={layoutsId} hidden={!layoutsExpanded}>
              <div className={editor.layoutChoices}>
                {editorialLayouts.map((layout) => <label className={`${editor.layoutChoice} ${layoutId === layout.id ? editor.layoutChoiceActive : ""}`} key={layout.id}><input type="radio" name="layoutId" value={layout.id} checked={layoutId === layout.id} onChange={() => setLayoutId(layout.id)} /><strong>{layout.name}</strong><small>{layout.description}</small></label>)}
              </div>
              <button className={editor.layoutDone} type="button" onClick={() => setLayoutsExpanded(false)}>Usar {selectedLayout.name} y ver la publicación</button>
            </div>
            <PublicationPreview draft={draft} layoutId={layoutId} coverUrl={coverUrl} inlineUrl={inlineUrl} gallery={gallery} />
          </fieldset>

          <div className={editor.publishRow}>
            <label>Guardar como<select name="status" disabled={pending} value={draft.status} onChange={(event) => changeField("status", event.target.value)}><option value="draft">Borrador para seguir editando</option>{canPublish ? <option value="published">Publicación visible en la revista</option> : null}</select></label>
            <p>{draft.status === "published" ? "Al guardar, esta publicación y sus fotografías quedarán visibles en la revista de la web." : "El borrador solo estará visible en este gestor. Puedes editarlo y publicarlo después."}</p>
          </div>
          {feedback && open ? <p className={styles.feedbackError} role="alert">{feedback}</p> : null}
          <div className={editor.actions}>
            <span>Al cerrar, el contenido escrito se conserva mientras sigas en esta página.</span>
            <button type="button" className={styles.buttonQuiet} onClick={closeDialog} disabled={pending}>Cerrar</button>
            <button type="submit" className={editor.saveButton} disabled={pending}>{pending ? "Guardando…" : story ? "Guardar cambios" : draft.status === "published" ? "Publicar en la revista" : "Guardar borrador"}</button>
          </div>
        </form>
      </dialog>
    </>
  );
}
