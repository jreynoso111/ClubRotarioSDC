"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { createClient } from "@/utils/supabase/client";

import styles from "./auth.module.css";

export function SignInForm({ nextPath, confirmationError = false }: { nextPath: string; confirmationError?: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState(confirmationError ? "El enlace no es válido o ha vencido. Solicita uno nuevo o inicia sesión." : "");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");
    setIsSubmitting(true);

    try {
      const { error } = await createClient().auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error) {
        setErrorMessage("No pudimos iniciar sesión. Revisa tu correo y contraseña.");
        setIsSubmitting(false);
        return;
      }

      router.replace(nextPath);
      router.refresh();
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
      <p className={styles.eyebrow}>Acceso de miembros</p>
      <h1 className={styles.title}>Volver al club.</h1>
      <p className={styles.copy}>
        Entra a la plataforma para seguir propuestas, actividades y decisiones del club.
      </p>
      <form className={styles.form} onSubmit={handleSubmit}>
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
          <span className={styles.label}>Contraseña</span>
          <input
            className={styles.input}
            type="password"
            autoComplete="current-password"
            minLength={6}
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {errorMessage ? <p role="alert" className={styles.error}>{errorMessage}</p> : null}
        <button className={styles.button} type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Entrando…" : "Entrar a la plataforma"}
        </button>
      </form>
      <p className={styles.links}><Link className={styles.link} href="/auth/forgot-password">Olvidé mi contraseña</Link></p>
      <p className={styles.links}>
        ¿Todavía no tienes una cuenta?{" "}
        <a className={styles.link} href="/auth/sign-up">
          Solicita acceso
        </a>
      </p>
      <p className={styles.meta}>Un espacio para organizar, colaborar y servir.</p>
    </section>
  );
}
