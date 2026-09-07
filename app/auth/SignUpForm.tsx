"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { createClient } from "@/utils/supabase/client";

import styles from "./auth.module.css";

export function SignUpForm() {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");
    setSuccessMessage("");
    setIsSubmitting(true);

    if (fullName.trim().length < 2) {
      setErrorMessage("Escribe tu nombre completo.");
      setIsSubmitting(false);
      return;
    }
    try {
      const { data, error } = await createClient().auth.signUp({
        email: email.trim(),
        password,
        options: { data: { display_name: fullName.trim() }, emailRedirectTo: `${window.location.origin}/auth/callback` },
      });

      if (error) {
        setErrorMessage("No pudimos crear la cuenta. Revisa los datos e inténtalo de nuevo.");
        setIsSubmitting(false);
        return;
      }

      if (data.session) {
        router.replace("/plataforma");
        router.refresh();
        return;
      }

      setSuccessMessage("Revisa tu correo para continuar. Si ya tenías una cuenta, puedes iniciar sesión o recuperar tu contraseña.");
    } catch {
      setErrorMessage("No pudimos conectar. Comprueba tu conexión e inténtalo de nuevo.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className={styles.card}>
      <Link className={styles.back} href="/">
        ← Club Rotario SDQ Colonial
      </Link>
      <p className={styles.eyebrow}>Tu primer paso</p>
      <h1 className={styles.title}>Tu historia puede empezar aquí.</h1>
      <p className={styles.copy}>
        Conecta con personas que quieren aportar a su comunidad. Crea tu cuenta para expresar tu interés; el club revisará tu solicitud y te acompañará en el proceso.
      </p>
      <form className={styles.form} onSubmit={handleSubmit}>
        <label className={styles.field}>
          <span className={styles.label}>Nombre completo</span>
          <input
            className={styles.input}
            type="text"
            autoComplete="name"
            minLength={2}
            maxLength={120}
            required
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>Correo electrónico</span>
          <input
            className={styles.input}
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>Contraseña · mínimo 8 caracteres</span>
          <input
            className={styles.input}
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {errorMessage ? <p role="alert" className={styles.error}>{errorMessage}</p> : null}
        {successMessage ? <p role="status" className={styles.success}>{successMessage}</p> : null}
        <button className={styles.button} type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Creando cuenta…" : "Quiero formar parte"}
        </button>
      </form>
      <p className={styles.links}>
        ¿Ya tienes una cuenta?{" "}
        <a className={styles.link} href="/auth/sign-in">
          Entrar
        </a>
      </p>
      <p className={styles.meta}>Crear tu cuenta no activa automáticamente la membresía ni genera un pago.</p>
    </section>
  );
}
