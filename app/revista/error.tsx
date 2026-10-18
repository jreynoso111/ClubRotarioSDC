"use client";

import Link from "next/link";
import { useEffect } from "react";

import { PublicShell } from "@/components/public/PublicChrome";

import styles from "./magazine.module.css";

export default function RevistaError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <PublicShell active="revista">
      <main className={styles.main}>
        <section className={styles.issueEmpty}>
          <p className={styles.issueEmptyText}>No pudimos abrir esta publicación en este momento.</p>
          <div className={styles.issueEmptyActions}>
            <button type="button" onClick={() => retry()}>Intentar de nuevo</button>
            <Link href="/revista">Volver a la revista</Link>
          </div>
        </section>
      </main>
    </PublicShell>
  );
}
