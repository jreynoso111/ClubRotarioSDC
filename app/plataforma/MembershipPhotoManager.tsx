"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";

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
  type MembershipPhotoSlotsActionResult,
} from "./actions";
import styles from "./membership-photo-manager.module.css";

function formatUpdatedAt(value: string | null) {
  if (!value) return "Sin cambios todavía";
  return new Intl.DateTimeFormat("es-DO", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Santo_Domingo",
  }).format(new Date(value));
}

function mergePhotoSlots(records: MembershipPhotoSlotRecord[]) {
  const recordsByKey = new Map(records.map((record) => [record.key, record]));
  return emptyMembershipPhotoSlots().map((slot) => ({
    ...slot,
    ...recordsByKey.get(slot.key),
  }));
}

export function MembershipPhotoManager() {
  const router = useRouter();
  const [slots, setSlots] = useState<MembershipPhotoSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [busySlot, setBusySlot] = useState<MembershipPhotoSlotKey | null>(null);
  const [feedback, setFeedback] = useState("");
  const [feedbackError, setFeedbackError] = useState(false);

  useEffect(() => {
    let active = true;
    void getMembershipPhotoSlotsAction()
      .then((result: MembershipPhotoSlotsActionResult) => {
        if (!active) return;
        setSlots(result.ok ? mergePhotoSlots(result.slots) : []);
        setFeedback(result.ok ? "" : result.message);
        setFeedbackError(!result.ok);
      })
      .catch(() => {
        if (!active) return;
        setSlots([]);
        setFeedback("No se pudieron cargar los espacios fotográficos. Actualiza e inténtalo de nuevo.");
        setFeedbackError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function saveSlot(event: FormEvent<HTMLFormElement>, slot: MembershipPhotoSlot) {
    event.preventDefault();
    if (busySlot) return;

    const form = event.currentTarget;
    const formData = new FormData(form);
    const fileValue = formData.get("photo");
    const file = fileValue instanceof File && fileValue.size > 0 ? fileValue : null;
    const altText = String(formData.get("altText") ?? "").trim();
    const caption = String(formData.get("caption") ?? "").trim();
    const isPublished = formData.get("isPublished") === "on";

    if (file && !isSupportedMembershipPhotoType(file.type)) {
      setFeedback("Usa una fotografía JPG, PNG o WebP.");
      setFeedbackError(true);
      return;
    }
    if (file && file.size > MAX_MEMBERSHIP_PHOTO_BYTES) {
      setFeedback("La fotografía debe pesar 10 MB o menos.");
      setFeedbackError(true);
      return;
    }
    if ((file || slot.imagePath) && altText.length === 0) {
      setFeedback("Escribe una descripción accesible para la fotografía.");
      setFeedbackError(true);
      return;
    }

    setBusySlot(slot.key);
    setFeedback("");
    setFeedbackError(false);
    let uploadedPath: string | null = null;
    let saved = false;

    try {
      if (file) {
        const extension = membershipPhotoExtension(file.type);
        if (!extension) throw new Error("El formato de la fotografía no es válido.");
        uploadedPath = `site-photos/membership-application/${slot.key}/${crypto.randomUUID()}.${extension}`;
        const { error: uploadError } = await createClient()
          .storage
          .from("club-public")
          .upload(uploadedPath, file, {
            cacheControl: "3600",
            contentType: file.type,
            upsert: false,
          });
        if (uploadError) throw new Error("No se pudo subir la fotografía. Revisa tu conexión y el acceso de edición.");
      }

      const imagePath = formData.get("removePhoto") === "on"
        ? null
        : uploadedPath ?? slot.imagePath;
      const shouldPublish = imagePath ? isPublished : false;
      const result = await updateMembershipPhotoSlotAction({
        slotKey: slot.key,
        imagePath,
        altText: imagePath ? altText : "",
        caption: imagePath ? caption : null,
        isPublished: shouldPublish,
      });

      if (!result.ok) {
        if (uploadedPath) await createClient().storage.from("club-public").remove([uploadedPath]);
        setFeedback(result.message);
        setFeedbackError(true);
        return;
      }

      saved = true;
      setFeedback(result.message);
      setFeedbackError(false);
      try {
        const refreshedSlots = await getMembershipPhotoSlotsAction();
        if (refreshedSlots.ok) setSlots(mergePhotoSlots(refreshedSlots.slots));
      } catch {
        // The saved photo is already live; a refresh can fetch the latest server copy.
      }
      router.refresh();
    } catch (error) {
      if (uploadedPath && !saved) await createClient().storage.from("club-public").remove([uploadedPath]);
      setFeedback(error instanceof Error ? error.message : "No se pudo guardar la fotografía.");
      setFeedbackError(true);
    } finally {
      setBusySlot(null);
    }
  }

  return (
    <section className={styles.manager} aria-label="Gestión de fotografías sociales">
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Contenido público · solicitud de membresía</p>
          <h2>Fotografías del club</h2>
          <p>Prepara una imagen para cada espacio y publícala cuando esté lista.</p>
        </div>
        <p className={styles.privacyNote}>Publica solo fotos aprobadas para uso público y con autorización de las personas que aparecen.</p>
      </header>

      {feedback ? <p className={feedbackError ? styles.error : styles.success} role={feedbackError ? "alert" : "status"}>{feedback}</p> : null}

      {loading ? <p className={styles.loading} role="status">Cargando espacios fotográficos…</p> : null}

      {!loading && slots.length === 0 && !feedbackError ? (
        <p className={styles.error} role="alert">No hay espacios fotográficos disponibles.</p>
      ) : null}

      <div className={styles.grid} aria-busy={loading}>
        {slots.map((slot) => (
          <article className={styles.card} key={slot.key}>
            <div className={styles.preview}>
              {slot.imageUrl ? (
                <Image src={slot.imageUrl} alt={slot.altText} fill sizes="(max-width: 800px) 100vw, 30vw" />
              ) : (
                <div className={styles.emptyPreview}>
                  <span aria-hidden="true">+</span>
                  <small>Espacio listo para una foto</small>
                </div>
              )}
              <span className={slot.isPublished ? styles.published : styles.draft}>
                {slot.isPublished ? "Publicada" : "Borrador"}
              </span>
            </div>

            <form className={styles.form} onSubmit={(event) => void saveSlot(event, slot)}>
              <div className={styles.titleRow}>
                <div>
                  <span className={styles.number}>{String(slot.order).padStart(2, "0")} / 03</span>
                  <h3>{slot.title}</h3>
                </div>
                <span className={styles.updated}>{formatUpdatedAt(slot.updatedAt)}</span>
              </div>
              <p className={styles.description}>{slot.description}</p>

              <label className={styles.field}>
                Cambiar fotografía
                <input
                  key={`${slot.key}-${slot.imagePath ?? "empty"}`}
                  name="photo"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  disabled={loading || busySlot !== null}
                />
                <small>JPG, PNG o WebP · máximo 10 MB</small>
              </label>
              <label className={styles.field}>
                Descripción accesible
                <input name="altText" required={Boolean(slot.imagePath)} maxLength={250} defaultValue={slot.altText} placeholder="Qué sucede en la foto" />
              </label>
              <label className={styles.field}>
                Pie de foto
                <input name="caption" maxLength={300} defaultValue={slot.caption ?? ""} placeholder="Lugar, fecha o contexto (opcional)" />
              </label>

              {slot.imagePath ? (
                <label className={styles.remove}>
                  <input name="removePhoto" type="checkbox" />
                  <span>Retirar esta foto del espacio</span>
                </label>
              ) : null}
              <label className={styles.publish}>
                <input name="isPublished" type="checkbox" defaultChecked={slot.isPublished} />
                <span>Mostrar esta foto en la solicitud pública</span>
              </label>

              <button className={styles.save} type="submit" disabled={busySlot !== null || loading}>
                {busySlot === slot.key ? "Guardando…" : "Guardar espacio"}
              </button>
            </form>
          </article>
        ))}
      </div>
    </section>
  );
}
