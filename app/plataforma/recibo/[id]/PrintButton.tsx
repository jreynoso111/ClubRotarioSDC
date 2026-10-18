"use client";

import styles from "./receipt.module.css";

export function PrintButton() {
  return <button type="button" className={styles.print} onClick={() => window.print()}>Imprimir o guardar en PDF</button>;
}
