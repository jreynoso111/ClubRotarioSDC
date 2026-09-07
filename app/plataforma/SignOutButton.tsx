"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/utils/supabase/client";

import styles from "./platform.module.css";

export function SignOutButton() {
  const router = useRouter();
  const [isSigningOut, setIsSigningOut] = useState(false);

  async function signOut() {
    setIsSigningOut(true);
    await createClient().auth.signOut();
    router.replace("/");
    router.refresh();
  }

  return (
    <button className={styles.buttonQuiet} type="button" onClick={signOut} disabled={isSigningOut}>
      {isSigningOut ? "Saliendo…" : "Cerrar sesión"}
    </button>
  );
}
