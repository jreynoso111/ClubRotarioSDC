import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { financeCategoryLabels, financePaymentMethodLabels, type FinanceCategory, type FinancePaymentMethod } from "@/lib/finance";
import { createClient } from "@/utils/supabase/server";
import { PrintButton } from "./PrintButton";
import styles from "./receipt.module.css";

export const metadata: Metadata = { title: "Recibo", robots: { index: false, follow: false } };

type ReceiptRow = {
  id: string; receipt_number: number | null; occurred_on: string; category: string; amount: number | string; description: string;
  member_name_snapshot: string | null; counterparty_name: string | null; activity_name_snapshot: string | null;
  payment_method: string; receipt_reference: string | null; voided_at: string | null; void_reason: string | null; created_at: string;
};

function money(value: number | string) {
  return new Intl.NumberFormat("es-DO", { style: "currency", currency: "DOP" }).format(Number(value));
}
function longDate(value: string) {
  return new Intl.DateTimeFormat("es-DO", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
}

// Read with the visitor's own session: row-level security limits receipts to
// club management and the member the payment belongs to.
export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const { data } = await supabase.from("finance_entries")
    .select("id,receipt_number,occurred_on,category,amount,description,member_name_snapshot,counterparty_name,activity_name_snapshot,payment_method,receipt_reference,voided_at,void_reason,created_at")
    .eq("id", id).eq("direction", "income").maybeSingle();
  const receipt = data as ReceiptRow | null;
  if (!receipt) notFound();
  const payer = receipt.member_name_snapshot ?? receipt.counterparty_name ?? "Aportante del club";

  return <main className={styles.page}>
    <div className={styles.actions}><Link href="/plataforma">← Volver a la plataforma</Link><PrintButton /></div>
    <article className={styles.receipt} aria-label={`Recibo ${receipt.receipt_number ?? ""}`}>
      {receipt.voided_at ? <p className={styles.voided} role="status">ANULADO · {receipt.void_reason}</p> : null}
      <header className={styles.header}>
        <Image src="/club-santo-domingo-colonial-logo.png" alt="Rotary Club Santo Domingo Colonial" width={1401} height={310} className={styles.logo} priority />
        <div><h1>Recibo de ingreso</h1><p className={styles.number}>N.º {String(receipt.receipt_number ?? 0).padStart(6, "0")}</p></div>
      </header>
      <dl className={styles.details}>
        <div><dt>Fecha</dt><dd>{longDate(receipt.occurred_on)}</dd></div>
        <div><dt>Recibimos de</dt><dd>{payer}</dd></div>
        <div><dt>Concepto</dt><dd>{receipt.description}<small>{financeCategoryLabels[receipt.category as FinanceCategory] ?? receipt.category}{receipt.activity_name_snapshot ? ` · ${receipt.activity_name_snapshot}` : ""}</small></dd></div>
        <div><dt>Medio de pago</dt><dd>{financePaymentMethodLabels[receipt.payment_method as FinancePaymentMethod] ?? receipt.payment_method}{receipt.receipt_reference ? ` · Ref. ${receipt.receipt_reference}` : ""}</dd></div>
      </dl>
      <p className={styles.amount}><span>Monto recibido</span><strong>{money(receipt.amount)}</strong></p>
      <footer className={styles.footer}>
        <p>Rotary Club Santo Domingo Colonial · Recibo generado digitalmente desde la plataforma del club.</p>
        <p>Código de verificación: {receipt.id.slice(0, 8).toUpperCase()}</p>
      </footer>
    </article>
  </main>;
}
