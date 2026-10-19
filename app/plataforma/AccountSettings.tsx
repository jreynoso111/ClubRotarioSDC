"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";

import { accountBioMaxLength, avatarAcceptedTypes, avatarBucket, avatarPathFor } from "@/lib/account";
import { prepareAvatarImage } from "@/lib/avatar-image";
import { formatClubDate } from "@/lib/club-date";
import { MAX_INPUT_IMAGE_BYTES } from "@/lib/image-compress";
import type { PlatformSnapshot } from "@/lib/platform";
import { createClient } from "@/utils/supabase/client";

import {
  changeEmailAction,
  changePasswordAction,
  removeAvatarAction,
  requestPasswordCodeAction,
  saveAvatarAction,
  signOutEverywhereAction,
  updateOwnProfileAction,
  type AccountActionResult,
} from "./account-actions";
import { MemberAvatar } from "./MemberAvatar";
import styles from "./account-settings.module.css";

type AccountUser = NonNullable<PlatformSnapshot["user"]>;
type Notice = { tone: "success" | "error"; text: string } | null;
type FactorState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; factor: { name: string; createdAt: string } | null };

function AccountNotice({ notice }: { notice: Notice }) {
  if (!notice) return null;
  return <p className={notice.tone === "error" ? styles.errorNotice : styles.successNotice}
    role={notice.tone === "error" ? "alert" : "status"}>{notice.text}</p>;
}

// Runs one server action with its own pending flag and feedback. Failed network calls never leave the form stuck.
async function perform(
  action: () => Promise<AccountActionResult>,
  setBusy: (busy: boolean) => void,
  setNotice: (notice: Notice) => void,
  onSuccess?: () => void,
) {
  setBusy(true);
  setNotice(null);
  try {
    const result = await action();
    setNotice({ tone: result.ok ? "success" : "error", text: result.message });
    if (result.ok) onSuccess?.();
    return result;
  } catch {
    setNotice({ tone: "error", text: "No se pudo completar la acción. Revisa tu conexión e inténtalo de nuevo." });
    return null;
  } finally {
    setBusy(false);
  }
}

export function AccountSettings({ user }: { user: AccountUser }) {
  const router = useRouter();

  const [savingProfile, setSavingProfile] = useState(false);
  const [profileNotice, setProfileNotice] = useState<Notice>(null);
  const [bio, setBio] = useState(user.bio);

  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarStep, setAvatarStep] = useState<"optimizing" | "uploading">("uploading");
  const [avatarNotice, setAvatarNotice] = useState<Notice>(null);
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);
  const avatarInput = useRef<HTMLInputElement>(null);

  const [emailBusy, setEmailBusy] = useState(false);
  const [emailNotice, setEmailNotice] = useState<Notice>(null);

  const [codeRequested, setCodeRequested] = useState(false);
  const [codeBusy, setCodeBusy] = useState(false);
  const [codeNotice, setCodeNotice] = useState<Notice>(null);
  const [setupRequired, setSetupRequired] = useState(false);
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordNotice, setPasswordNotice] = useState<Notice>(null);

  const [factor, setFactor] = useState<FactorState>({ status: "loading" });
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [securityNotice, setSecurityNotice] = useState<Notice>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { data, error } = await createClient().auth.mfa.listFactors();
        if (!active) return;
        if (error || !data) { setFactor({ status: "error" }); return; }
        const verified = data.totp[0];
        setFactor({ status: "ready", factor: verified ? { name: verified.friendly_name || "Autenticador", createdAt: verified.created_at } : null });
      } catch {
        if (active) setFactor({ status: "error" });
      }
    })();
    return () => { active = false; };
  }, []);

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await perform(() => updateOwnProfileAction({
      displayName: String(data.get("displayName") ?? ""),
      bio: String(data.get("bio") ?? ""),
    }), setSavingProfile, setProfileNotice, () => router.refresh());
  }

  async function chooseAvatar(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    if (!avatarAcceptedTypes.includes(file.type as (typeof avatarAcceptedTypes)[number])) {
      setAvatarNotice({ tone: "error", text: "Usa una foto JPG, PNG o WebP." });
      return;
    }
    if (file.size > MAX_INPUT_IMAGE_BYTES) {
      setAvatarNotice({ tone: "error", text: "La foto es demasiado grande (máximo 60 MB)." });
      return;
    }

    setAvatarBusy(true);
    setAvatarStep("optimizing");
    setAvatarNotice(null);
    const supabase = createClient();
    let uploadedPath: string | null = null;
    let saved = false;
    try {
      const prepared = await prepareAvatarImage(file);
      setAvatarStep("uploading");
      uploadedPath = avatarPathFor(user.id, crypto.randomUUID());
      const { error: uploadError } = await supabase.storage.from(avatarBucket).upload(uploadedPath, prepared, {
        contentType: "image/webp", cacheControl: "3600", upsert: false,
      });
      if (uploadError) throw new Error("No se pudo subir la foto. Revisa tu conexión y vuelve a intentarlo.");
      const result = await saveAvatarAction(uploadedPath);
      setAvatarNotice({ tone: result.ok ? "success" : "error", text: result.message });
      if (result.ok) {
        saved = true;
        router.refresh();
      }
    } catch (failure) {
      setAvatarNotice({ tone: "error", text: failure instanceof Error ? failure.message : "No se pudo guardar la foto. Inténtalo de nuevo." });
    } finally {
      // An upload that never reached the profile is removed so the folder keeps no orphan files.
      if (uploadedPath && !saved) {
        try { await supabase.storage.from(avatarBucket).remove([uploadedPath]); } catch { /* The save error stays visible. */ }
      }
      setAvatarBusy(false);
    }
  }

  async function removeAvatar() {
    setConfirmingRemoval(false);
    await perform(() => removeAvatarAction(), setAvatarBusy, setAvatarNotice, () => router.refresh());
  }

  async function changeEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const email = String(new FormData(form).get("email") ?? "");
    await perform(() => changeEmailAction(email), setEmailBusy, setEmailNotice, () => form.reset());
  }

  async function requestCode() {
    const result = await perform(() => requestPasswordCodeAction(), setCodeBusy, setCodeNotice, () => setCodeRequested(true));
    if (result?.code === "password_setup_required") setSetupRequired(true);
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const result = await perform(() => changePasswordAction({
      code: String(data.get("code") ?? ""),
      password: String(data.get("password") ?? ""),
      confirm: String(data.get("confirm") ?? ""),
    }), setPasswordBusy, setPasswordNotice, () => { form.reset(); setCodeRequested(false); });
    // An expired or invalid code needs a new one before trying again.
    if (result?.code === "reauthentication_required") setCodeRequested(false);
  }

  async function signOutEverywhere() {
    setSigningOut(true);
    setSecurityNotice(null);
    try {
      await signOutEverywhereAction();
    } catch {
      setSecurityNotice({ tone: "error", text: "No pudimos cerrar tus sesiones. Inténtalo de nuevo." });
      setSigningOut(false);
    }
  }

  return <div className={styles.layout}>
    <article className={`${styles.card} ${styles.wide}`} aria-labelledby="account-profile-title">
      <p className={styles.cardLabel}>Perfil</p>
      <h2 id="account-profile-title" className={styles.cardTitle}>Cómo te ven en el club.</h2>
      <div className={styles.avatarRow}>
        <MemberAvatar userId={user.id} name={user.displayName} avatarVersion={user.avatarVersion} className={styles.avatarPreview} />
        <div className={styles.avatarActions}>
          <p className={styles.hint}>JPG, PNG o WebP. Puedes subir fotos grandes; el sistema las optimiza automáticamente. La recortamos al centro y la guardamos en un cuadrado de 512 × 512 píxeles.</p>
          <div className={styles.actionRow}>
            <button type="button" className={styles.button} disabled={avatarBusy} onClick={() => avatarInput.current?.click()}>
              {avatarBusy ? (avatarStep === "optimizing" ? "Optimizando foto…" : "Subiendo foto…") : "Cambiar foto"}
            </button>
            {user.avatarVersion && !confirmingRemoval && <button type="button" className={styles.buttonQuiet} disabled={avatarBusy}
              onClick={() => setConfirmingRemoval(true)}>Quitar foto</button>}
          </div>
          {confirmingRemoval && <div role="group" aria-label="Confirmar quitar la foto" className={styles.confirmBox}>
            <p>¿Quitar tu foto? Se mostrarán tus iniciales.</p>
            <div className={styles.actionRow}>
              <button type="button" className={styles.dangerButton} disabled={avatarBusy} onClick={removeAvatar}>Sí, quitar foto</button>
              <button type="button" className={styles.buttonQuiet} onClick={() => setConfirmingRemoval(false)}>Cancelar</button>
            </div>
          </div>}
          <input ref={avatarInput} type="file" accept={avatarAcceptedTypes.join(",")} className={styles.visuallyHidden}
            tabIndex={-1} aria-hidden="true" onChange={chooseAvatar} />
          <AccountNotice notice={avatarNotice} />
        </div>
      </div>
      <form className={styles.form} onSubmit={saveProfile}>
        <label>Nombre<input name="displayName" defaultValue={user.displayName} required minLength={2} maxLength={120} autoComplete="name" /></label>
        <label>Biografía<textarea name="bio" value={bio} maxLength={accountBioMaxLength} rows={4} onChange={event => setBio(event.target.value)} />
          <span className={styles.counter}>{bio.length} / {accountBioMaxLength}</span></label>
        <button className={styles.button} disabled={savingProfile}>{savingProfile ? "Guardando…" : "Guardar perfil"}</button>
        <AccountNotice notice={profileNotice} />
      </form>
    </article>

    <article className={styles.card} aria-labelledby="account-email-title">
      <p className={styles.cardLabel}>Correo electrónico</p>
      <h2 id="account-email-title" className={styles.cardTitle}>Tu acceso al club.</h2>
      <p className={styles.current}>Actual: <strong>{user.email}</strong></p>
      <form className={styles.form} onSubmit={changeEmail}>
        <label>Nuevo correo<input type="email" name="email" required maxLength={254} autoComplete="email" /></label>
        <button className={styles.button} disabled={emailBusy}>{emailBusy ? "Enviando enlace…" : "Cambiar correo"}</button>
        <AccountNotice notice={emailNotice} />
      </form>
    </article>

    <article className={styles.card} aria-labelledby="account-password-title">
      <p className={styles.cardLabel}>Contraseña</p>
      <h2 id="account-password-title" className={styles.cardTitle}>Confirma que eres tú.</h2>
      {!codeRequested ? <>
        <p className={styles.hint}>Te enviaremos un código de 6 dígitos a tu correo antes de cambiar la contraseña.</p>
        <button type="button" className={styles.button} disabled={codeBusy} onClick={requestCode}>
          {codeBusy ? "Enviando código…" : "Enviar código a mi correo"}
        </button>
      </> : <form className={styles.form} onSubmit={changePassword}>
        <p className={styles.hint}>Escribe el código que llegó a {user.email}.</p>
        <label>Código de 6 dígitos<input name="code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code" required /></label>
        <label>Nueva contraseña<input type="password" name="password" minLength={8} maxLength={72} autoComplete="new-password" required /></label>
        <label>Repite la nueva contraseña<input type="password" name="confirm" minLength={8} maxLength={72} autoComplete="new-password" required /></label>
        <button className={styles.button} disabled={passwordBusy}>{passwordBusy ? "Cambiando contraseña…" : "Cambiar contraseña"}</button>
        <button type="button" className={styles.buttonQuiet} disabled={codeBusy || passwordBusy} onClick={requestCode}>Enviar otro código</button>
      </form>}
      {/* Outside the form: a successful change closes the form, and its confirmation must stay visible. */}
      <AccountNotice notice={passwordNotice} />
      <AccountNotice notice={codeNotice} />
      {setupRequired && <p className={styles.hint}><Link className={styles.inlineLink} href="/auth/first-password">Establecer mi contraseña inicial →</Link></p>}
    </article>

    <article className={styles.card} aria-labelledby="account-security-title">
      <p className={styles.cardLabel}>Seguridad</p>
      <h2 id="account-security-title" className={styles.cardTitle}>Protege tu cuenta.</h2>
      <div className={styles.section}>
        <h3>Verificación en dos pasos</h3>
        {factor.status === "loading" && <p className={styles.hint} role="status">Consultando tu configuración…</p>}
        {factor.status === "error" && <p className={styles.errorNotice} role="alert">No pudimos consultar tu verificación. Recarga la página para intentarlo de nuevo.</p>}
        {factor.status === "ready" && (factor.factor
          ? <p className={styles.hint}><strong className={styles.enabled}>Activado</strong> · {factor.factor.name}, desde {formatClubDate(factor.factor.createdAt, false)}</p>
          : <p className={styles.hint}><strong>No configurado</strong></p>)}
        <Link className={styles.inlineLink} href="/auth/mfa">
          {factor.status === "ready" && factor.factor ? "Revisar o verificar" : "Configurar verificación"} →
        </Link>
      </div>
      <div className={styles.section}>
        <h3>Sesiones</h3>
        <p className={styles.hint}>Cierra tu sesión en este equipo y en cualquier otro dispositivo donde hayas entrado.</p>
        {!confirmingSignOut
          ? <button type="button" className={styles.buttonQuiet} onClick={() => setConfirmingSignOut(true)}>Cerrar sesión en todos los dispositivos</button>
          : <div role="group" aria-label="Confirmar el cierre de todas las sesiones" className={styles.confirmBox}>
            <p>¿Seguro? Tendrás que volver a iniciar sesión en todos tus dispositivos.</p>
            <div className={styles.actionRow}>
              <button type="button" className={styles.dangerButton} disabled={signingOut} onClick={signOutEverywhere}>
                {signingOut ? "Cerrando sesiones…" : "Sí, cerrar todas las sesiones"}
              </button>
              <button type="button" className={styles.buttonQuiet} disabled={signingOut} onClick={() => setConfirmingSignOut(false)}>Cancelar</button>
            </div>
          </div>}
        <AccountNotice notice={securityNotice} />
      </div>
    </article>
  </div>;
}
