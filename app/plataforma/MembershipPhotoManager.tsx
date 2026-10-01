"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";

import {
  emptyMembershipPhotoSlots,
  isSupportedMembershipPhotoType,
  MAX_MEMBERSHIP_PHOTO_BYTES,
  membershipPhotoExtension,
  type MembershipPhotoSlot,
  type MembershipPhotoSlotKey,
} from "@/lib/site-photos";
import { createClient } from "@/utils/supabase/client";

import {
  getMembershipPhotoSlotsAction,
  updateMembershipPhotoSlotAction,
  type MembershipPhotoSlotRecord,
} from "./actions";
import styles from "./membership-photo-manager.module.css";

const photoLocations: Record<MembershipPhotoSlotKey, { position: string; crop: string }> = {
  "membership-community": { position: "Galería de bienvenida · izquierda, foto grande", crop: "Foto vertical. Mantén a las personas en el centro para el recorte." },
  "membership-service": { position: "Galería de bienvenida · derecha, arriba", crop: "Foto horizontal. El recuadro recorta los bordes para llenar el espacio." },
  "membership-fellowship": { position: "Galería de bienvenida · derecha, abajo", crop: "Foto horizontal. El recuadro recorta los bordes para llenar el espacio." },
};

const siteDesignImages = [
  { src: "/club-santo-domingo-colonial-logo.png", title: "Logo del club", location: "Cabecera y pie de la web · plataforma", href: "/", logo: true },
  { src: "/alcazar-colon-illustration.png", title: "Alcázar de Colón", location: "Inicio · galería de bienvenida y portada de El club", href: "/nosotros", logo: false },
  { src: "/zona-colonial-illustration.png", title: "Calle de la Ciudad Colonial", location: "Inicio · galería de bienvenida", href: "/#inicio", logo: false },
  { src: "/zona-colonial-dusk.png", title: "Murallas al anochecer", location: "Inicio · galería de bienvenida", href: "/#inicio", logo: false },
  { src: "/zona-colonial-courtyard.png", title: "Patio colonial", location: "Inicio · galería de bienvenida", href: "/#inicio", logo: false },
  { src: "/zona-colonial-las-damas.png", title: "Calle Las Damas", location: "Inicio · galería de bienvenida", href: "/#inicio", logo: false },
  { src: "/zona-colonial-fortaleza.png", title: "Fortaleza Ozama", location: "Inicio · galería de bienvenida", href: "/#inicio", logo: false },
];

type PhotoDraft = {
  file: File | null;
  altText: string;
  caption: string;
  isPublished: boolean;
  removePhoto: boolean;
};

type PhotoFeedback = { slotKey: MembershipPhotoSlotKey; message: string; error: boolean };

function formatUpdatedAt(value: string | null) {
  if (!value) return "Todavía no se ha guardado una foto";
  return `Último cambio: ${new Intl.DateTimeFormat("es-DO", {
    dateStyle: "short", timeStyle: "short", timeZone: "America/Santo_Domingo",
  }).format(new Date(value))}`;
}

function mergePhotoSlots(records: MembershipPhotoSlotRecord[]) {
  const recordsByKey = new Map(records.map((record) => [record.key, record]));
  return emptyMembershipPhotoSlots().map((slot) => ({ ...slot, ...recordsByKey.get(slot.key) }));
}

function PhotoSlotEditor({ slot, hidden, pending, feedback, onSave }: {
  slot: MembershipPhotoSlot;
  hidden: boolean;
  pending: boolean;
  feedback: PhotoFeedback | null;
  onSave: (slot: MembershipPhotoSlot, draft: PhotoDraft) => Promise<void>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [fileVersion, setFileVersion] = useState(0);
  const [fileError, setFileError] = useState("");
  const [altText, setAltText] = useState(slot.altText);
  const [caption, setCaption] = useState(slot.caption ?? "");
  const [isPublished, setIsPublished] = useState(slot.isPublished);
  const [removePhoto, setRemovePhoto] = useState(false);
  const objectUrl = useRef<string | null>(null);
  const hasPhoto = !removePhoto && Boolean(file || slot.imagePath);
  const changed = Boolean(file || removePhoto || altText !== slot.altText || caption !== (slot.caption ?? "") || isPublished !== slot.isPublished);
  const location = photoLocations[slot.key];

  useEffect(() => () => {
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
  }, []);

  function clearSelection() {
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = null;
    setFile(null);
    setPreviewUrl(null);
    setFileError("");
    setFileVersion((value) => value + 1);
  }

  function choosePhoto(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.currentTarget.files?.[0];
    if (!selected) return;
    if (!isSupportedMembershipPhotoType(selected.type) || selected.size > MAX_MEMBERSHIP_PHOTO_BYTES) {
      clearSelection();
      setFileError(!isSupportedMembershipPhotoType(selected.type) ? "Elige una fotografía JPG, PNG o WebP." : "La fotografía debe pesar 10 MB o menos.");
      return;
    }
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = URL.createObjectURL(selected);
    setFile(selected);
    setPreviewUrl(objectUrl.current);
    setRemovePhoto(false);
    setFileError("");
  }

  function discardChanges() {
    clearSelection();
    setAltText(slot.altText);
    setCaption(slot.caption ?? "");
    setIsPublished(slot.isPublished);
    setRemovePhoto(false);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void onSave(slot, { file, altText, caption, isPublished, removePhoto });
  }

  return (
    <article className={styles.editor} hidden={hidden} aria-labelledby={`photo-editor-${slot.key}`}>
      <div className={styles.editorHeading}>
        <div>
          <span className={styles.eyebrow}>Solicitud de ingreso · fotografía {slot.order} de 3</span>
          <h3 id={`photo-editor-${slot.key}`}>{slot.title}</h3>
          <p>{location.position}</p>
        </div>
        <a className={styles.textLink} href={`/solicitar-membresia#${slot.key}`} target="_blank" rel="noreferrer">Ver ubicación en la web ↗</a>
      </div>

      {feedback ? <p className={feedback.error ? styles.error : styles.success} role={feedback.error ? "alert" : "status"}>{feedback.message}</p> : null}

      <div className={styles.editorBody}>
        <div className={styles.previewColumn}>
          <div className={styles.preview} data-featured={slot.order === 1 ? "true" : "false"}>
            {hasPhoto && (previewUrl || slot.imageUrl) ? (
              <Image src={previewUrl ?? slot.imageUrl!} alt={altText || `Vista previa de ${slot.title}`} fill sizes="(max-width: 760px) 100vw, 35vw" unoptimized />
            ) : (
              <div className={styles.emptyPreview}>
                <span aria-hidden="true">{removePhoto ? "−" : "+"}</span>
                <strong>{removePhoto ? "La foto se retirará al guardar" : "Esta ubicación todavía no tiene foto"}</strong>
              </div>
            )}
            <span className={changed ? styles.draft : slot.isPublished ? styles.published : styles.draft}>
              {changed ? "Vista previa · sin guardar" : slot.isPublished ? "Publicada" : slot.imagePath ? "Borrador" : "Espacio vacío"}
            </span>
          </div>
          <p className={styles.cropNote}>{location.crop}</p>
          <div className={styles.currentState}>
            <strong>Estado actual en la web: {slot.isPublished ? "foto visible" : slot.imagePath ? "foto oculta (borrador)" : "espacio vacío"}</strong>
            <span>{formatUpdatedAt(slot.updatedAt)}</span>
          </div>
        </div>

        <form className={styles.form} onSubmit={submit}>
          <fieldset disabled={pending}>
            <label className={styles.field}>
              {slot.imagePath ? "Reemplazar fotografía" : "Elegir fotografía"}
              <input key={fileVersion} name="photo" type="file" accept="image/jpeg,image/png,image/webp" onChange={choosePhoto} />
              <small>JPG, PNG o WebP · máximo 10 MB. Verás la imagen antes de guardarla.</small>
            </label>
            {fileError ? <p className={styles.error} role="alert">{fileError}</p> : null}
            {file ? <div className={styles.selection}><span>{file.name}</span><button type="button" onClick={clearSelection}>Quitar selección</button></div> : null}
            <label className={styles.field}>
              Descripción de la foto
              <input name="altText" required={hasPhoto} maxLength={250} value={altText} onChange={(event) => setAltText(event.target.value)} placeholder="Ej.: socios entregando útiles escolares" />
              <small>Describe lo que aparece para las personas que usan un lector de pantalla.</small>
            </label>
            <label className={styles.field}>
              Pie de foto <span>(opcional)</span>
              <input name="caption" maxLength={300} value={caption} onChange={(event) => setCaption(event.target.value)} placeholder="Lugar, fecha o nombre de la actividad" />
              <small>Se muestra debajo de esta fotografía en la página pública.</small>
            </label>
            {slot.imagePath ? <label className={styles.remove}><input name="removePhoto" type="checkbox" checked={removePhoto} onChange={(event) => setRemovePhoto(event.target.checked)} /><span>Retirar la fotografía de esta ubicación</span></label> : null}
            <label className={styles.publish}>
              <input name="isPublished" type="checkbox" checked={hasPhoto && isPublished} disabled={!hasPhoto} onChange={(event) => setIsPublished(event.target.checked)} />
              <span><strong>Publicar en la web</strong><small>{removePhoto ? "Al guardar, esta ubicación vuelve a mostrar el espacio vacío." : hasPhoto && isPublished ? "Al guardar, la foto y el pie de foto serán visibles en Solicitud de ingreso." : "Al guardar, la foto queda en borrador y se oculta de la página pública."}</small></span>
            </label>
            <div className={styles.formActions}>
              <button className={styles.save} type="submit" disabled={!changed || (!hasPhoto && !slot.imagePath)}>{pending ? "Guardando…" : removePhoto ? "Guardar y retirar foto" : isPublished && hasPhoto ? "Guardar y publicar" : "Guardar borrador"}</button>
              <button className={styles.quietButton} type="button" disabled={!changed} onClick={discardChanges}>Descartar cambios</button>
            </div>
            <p className={styles.saveNote}>Los cambios se aplican solo a esta ubicación al guardar.</p>
          </fieldset>
        </form>
      </div>
    </article>
  );
}

export function MembershipPhotoManager({ onOpenMagazine }: { onOpenMagazine?: () => void }) {
  const router = useRouter();
  const [slots, setSlots] = useState<MembershipPhotoSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [activeSlot, setActiveSlot] = useState<MembershipPhotoSlotKey>("membership-community");
  const [busySlot, setBusySlot] = useState<MembershipPhotoSlotKey | null>(null);
  const [feedback, setFeedback] = useState<PhotoFeedback | null>(null);

  useEffect(() => {
    let active = true;
    void getMembershipPhotoSlotsAction()
      .then((result) => {
        if (!active) return;
        setSlots(result.ok ? mergePhotoSlots(result.slots) : []);
        setLoadError(result.ok ? "" : result.message);
      })
      .catch(() => {
        if (active) setLoadError("No se pudieron cargar las fotografías. Revisa tu conexión e inténtalo de nuevo.");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [loadAttempt]);

  async function saveSlot(slot: MembershipPhotoSlot, draft: PhotoDraft) {
    if (busySlot) return;
    const altText = draft.altText.trim();
    if (!draft.removePhoto && (draft.file || slot.imagePath) && !altText) {
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
      if (draft.file && !draft.removePhoto) {
        const extension = membershipPhotoExtension(draft.file.type);
        if (!extension || draft.file.size > MAX_MEMBERSHIP_PHOTO_BYTES) throw new Error("Usa una fotografía JPG, PNG o WebP de 10 MB o menos.");
        uploadedPath = `site-photos/membership-application/${slot.key}/${crypto.randomUUID()}.${extension}`;
        const { error } = await supabase.storage.from("club-public").upload(uploadedPath, draft.file, { cacheControl: "3600", contentType: draft.file.type, upsert: false });
        if (error) throw new Error("No se pudo subir la fotografía. Revisa tu conexión y vuelve a guardar.");
      }
      const imagePath = draft.removePhoto ? null : uploadedPath ?? slot.imagePath;
      const isPublished = Boolean(imagePath && draft.isPublished);
      const result = await updateMembershipPhotoSlotAction({ slotKey: slot.key, imagePath, altText: imagePath ? altText : "", caption: imagePath ? draft.caption.trim() || null : null, isPublished });
      if (!result.ok) {
        await discardUpload();
        setFeedback({ slotKey: slot.key, message: result.message, error: true });
        return;
      }
      saved = true;
      setSlots((current) => current.map((photo) => photo.key === slot.key ? {
        ...photo, imagePath, imageUrl: imagePath ? supabase.storage.from("club-public").getPublicUrl(imagePath).data.publicUrl : null,
        altText: imagePath ? altText : "", caption: imagePath ? draft.caption.trim() || null : null, isPublished, updatedAt: new Date().toISOString(),
      } : photo));
      setFeedback({ slotKey: slot.key, message: imagePath ? result.message : `Se retiró la fotografía «${slot.title}» de Solicitud de ingreso.`, error: false });
      try {
        const refreshed = await getMembershipPhotoSlotsAction();
        if (refreshed.ok) setSlots(mergePhotoSlots(refreshed.slots));
      } catch { /* The confirmed save is already reflected in the editor. */ }
      router.refresh();
    } catch (error) {
      await discardUpload();
      setFeedback({ slotKey: slot.key, message: error instanceof Error ? error.message : "No se pudo guardar la fotografía. Inténtalo de nuevo.", error: true });
    } finally { setBusySlot(null); }
  }

  return (
    <section className={styles.manager} aria-label="Fotos de la web">
      <header className={styles.header}>
        <div><p className={styles.eyebrow}>Gestión del contenido público</p><h2>Fotos de la web</h2><p>Elige una ubicación para ver exactamente qué fotografía estás cambiando.</p></div>
        <p className={styles.privacyNote}>Publica fotos aprobadas para uso público y con autorización de las personas que aparecen.</p>
      </header>

      <div className={styles.destinations}>
        <div className={styles.destinationActive}><span className={styles.destinationIcon} aria-hidden="true">01</span><div><strong>Solicitud de ingreso</strong><p>Tres fotos de bienvenida, editables aquí.</p><a href="/solicitar-membresia" target="_blank" rel="noreferrer">Abrir página ↗</a></div></div>
        <div className={styles.destination}><span className={styles.destinationIcon} aria-hidden="true">02</span><div><strong>Publicaciones de la revista</strong><p>La portada y las fotos se eligen dentro de cada publicación.</p>{onOpenMagazine ? <button type="button" onClick={onOpenMagazine}>Gestionar publicaciones →</button> : <a href="/revista" target="_blank" rel="noreferrer">Ver revista ↗</a>}</div></div>
      </div>

      {loadError ? <div className={styles.loadError}><p className={styles.error} role="alert">{loadError}</p><button className={styles.quietButton} type="button" disabled={loading} onClick={() => { setLoading(true); setLoadError(""); setLoadAttempt((value) => value + 1); }}>Volver a cargar</button></div> : null}
      {loading ? <p className={styles.loading} role="status">Cargando fotografías de Solicitud de ingreso…</p> : null}

      {!loading && !loadError && slots.length > 0 ? <>
        <section className={styles.locationMap} aria-label="Ubicación de las tres fotos en Solicitud de ingreso">
          <div className={styles.mapHeading}><div><h3>Solicitud de ingreso · galería de bienvenida</h3><p>Selecciona uno de los recuadros. La distribución refleja la página pública.</p></div><span>3 ubicaciones</span></div>
          <div className={styles.pageDiagram}>
            <div className={styles.diagramCopy} aria-hidden="true"><span>Quiero ser miembro</span><strong>Tu próximo capítulo puede empezar sirviendo.</strong><i /><i /><i /></div>
            <div className={styles.diagramGallery}>
              {slots.map((slot) => <button key={slot.key} type="button" className={styles.diagramSlot} data-featured={slot.order === 1 ? "true" : "false"} aria-pressed={activeSlot === slot.key} aria-controls={`editor-panel-${slot.key}`} onClick={() => setActiveSlot(slot.key)}>
                {slot.imageUrl && slot.isPublished ? <Image src={slot.imageUrl} alt="" fill sizes="(max-width: 760px) 35vw, 18vw" unoptimized /> : null}
                <span className={styles.diagramLabel}><b>{String(slot.order).padStart(2, "0")}</b><strong>{slot.title}</strong><small>{slot.isPublished ? "Visible en la web" : slot.imagePath ? "Borrador" : "Sin fotografía"}</small></span>
              </button>)}
            </div>
          </div>
        </section>
        <div aria-busy={busySlot !== null}>
          {slots.map((slot) => <div key={`${slot.key}-${slot.imagePath ?? "empty"}-${slot.updatedAt ?? "initial"}`} id={`editor-panel-${slot.key}`} hidden={activeSlot !== slot.key}><PhotoSlotEditor slot={slot} hidden={activeSlot !== slot.key} pending={busySlot !== null} feedback={feedback?.slotKey === slot.key ? feedback : null} onSave={saveSlot} /></div>)}
        </div>
      </> : null}

      <details className={styles.otherAssets}>
        <summary>Ver el logo y las ilustraciones del diseño de la web</summary>
        <p>Estos recursos forman parte del diseño del sitio y todavía no tienen un editor en la plataforma. Cada imagen indica la página donde se usa. Las fotografías de las publicaciones se cambian en Revista.</p>
        <div className={styles.designImages}>
          {siteDesignImages.map((asset) => <a className={styles.designImage} href={asset.href} key={asset.src} target="_blank" rel="noreferrer">
            <span className={styles.designImagePreview} data-logo={asset.logo ? "true" : "false"}><Image src={asset.src} alt={asset.title} fill sizes="(max-width: 760px) 40vw, 15vw" /></span>
            <strong>{asset.title}</strong><small>{asset.location}</small><span className={styles.designImageLink}>Ver página ↗</span>
          </a>)}
        </div>
      </details>
    </section>
  );
}
