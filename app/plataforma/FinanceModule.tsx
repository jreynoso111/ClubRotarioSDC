"use client";

import { useEffect, useState, useTransition } from "react";
import type { FormEvent } from "react";

import {
  financeCategoryLabels,
  financePaymentMethodLabels,
  type FinanceCategory,
  type FinanceDashboard,
  type FinanceEntryCategory,
  type FinancePaymentMethod,
} from "@/lib/finance";

import {
  createFinanceEntryAction,
  createFinanceMonthlyDuesAction,
  getFinanceDashboardAction,
  recordFinanceMonthlyPaymentAction,
} from "./actions";
import styles from "./platform.module.css";

const incomeCategories: FinanceEntryCategory[] = [
  "activity_contribution", "donation", "other_income",
];
const expenseCategories: FinanceEntryCategory[] = [
  "activity_expense", "operating_expense", "other_expense",
];

function currentMonth() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santo_Domingo",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  return `${parts.find((part) => part.type === "year")?.value}-${parts.find((part) => part.type === "month")?.value}`;
}

function today() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santo_Domingo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  return `${parts.find((part) => part.type === "year")?.value}-${parts.find((part) => part.type === "month")?.value}-${parts.find((part) => part.type === "day")?.value}`;
}

function formatMoney(value: string) {
  const amount = Number(value);
  return new Intl.NumberFormat("es-DO", {
    style: "currency",
    currency: "DOP",
    maximumFractionDigits: 2,
  }).format(Number.isFinite(amount) ? amount : 0);
}

function formatDate(value: string) {
  const date = new Date(`${value}T12:00:00.000Z`);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("es-DO", {
        day: "2-digit",
        month: "2-digit",
        year: "2-digit",
        timeZone: "UTC",
      }).format(date);
}

function formatMonth(value: string) {
  const date = new Date(`${value}-01T12:00:00.000Z`);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("es-DO", {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }).format(date);
}

function currencyNumber(value: string) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
}

function CategoryLabel({ category }: { category: FinanceCategory }) {
  return <span className={styles.financeCategory}>{financeCategoryLabels[category]}</span>;
}

export function FinanceModule({ canManage }: { canManage: boolean }) {
  const [month, setMonth] = useState(currentMonth);
  const [dashboard, setDashboard] = useState<FinanceDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [messageError, setMessageError] = useState(false);
  const [category, setCategory] = useState<FinanceEntryCategory>("activity_contribution");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let active = true;
    startTransition(async () => {
      const result = await getFinanceDashboardAction(month);
      if (!active) return;
      setDashboard(result.ok ? result.dashboard ?? null : null);
      setMessage(result.ok ? "" : result.message);
      setMessageError(!result.ok);
      setLoading(false);
    });
    return () => { active = false; };
  }, [month, startTransition]);

  function runAction(action: Promise<{ ok: boolean; message: string }>, onSuccess?: () => void) {
    startTransition(async () => {
      const result = await action;
      setMessage(result.message);
      setMessageError(!result.ok);
      if (result.ok) {
        onSuccess?.();
        const refreshed = await getFinanceDashboardAction(month);
        if (refreshed.ok && refreshed.dashboard) {
          setDashboard(refreshed.dashboard);
          setMessage(result.message);
          setMessageError(false);
        } else {
          setDashboard(null);
          setMessage(refreshed.message);
          setMessageError(true);
        }
      }
    });
  }

  function handleEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    runAction(createFinanceEntryAction({
      category,
      amount: String(data.get("amount") ?? ""),
      occurredOn: String(data.get("occurredOn") ?? ""),
      description: String(data.get("description") ?? ""),
      memberId: String(data.get("memberId") ?? "") || undefined,
      counterpartyName: String(data.get("counterpartyName") ?? "") || undefined,
      activityId: String(data.get("activityId") ?? "") || undefined,
      paymentMethod: String(data.get("paymentMethod") ?? "other") as FinancePaymentMethod,
      receiptReference: String(data.get("receiptReference") ?? "") || undefined,
    }), () => {
      form.reset();
      setCategory("activity_contribution");
    });
  }

  function handleGenerateDues(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const form = event.currentTarget;
    runAction(createFinanceMonthlyDuesAction({
      month: String(data.get("duesMonth") ?? ""),
      amountDue: String(data.get("amountDue") ?? ""),
    }), () => form.reset());
  }

  function handleMonthlyPayment(event: FormEvent<HTMLFormElement>, dueId: string) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    runAction(recordFinanceMonthlyPaymentAction({
      dueId,
      amount: String(data.get("paymentAmount") ?? ""),
      occurredOn: String(data.get("paymentDate") ?? ""),
      paymentMethod: String(data.get("paymentMethod") ?? "other") as FinancePaymentMethod,
      receiptReference: String(data.get("receiptReference") ?? "") || undefined,
    }), () => {
      form.reset();
      form.closest("details")?.removeAttribute("open");
    });
  }

  const summary = dashboard?.summary;
  const dues = dashboard?.dues ?? [];
  const entries = dashboard?.entries ?? [];

  return <section className={styles.financeModule} aria-label="Finanzas del club">
    <header className={styles.financeHeader}>
      <div>
        <p className={styles.cardLabel}>Administración del club</p>
        <h2 className={styles.cardTitle}>Finanzas</h2>
        <p className={styles.empty}>{canManage
          ? "Aportes, donaciones y egresos registrados con historial de cambios."
          : "Consulta tus aportes y el estado de tu cuota mensual."}</p>
      </div>
      <label className={styles.financeMonthLabel}>Período
        <input type="month" value={month} onChange={(event) => { setLoading(true); setMonth(event.target.value); }} />
      </label>
    </header>

    {message ? <p className={messageError ? styles.feedbackError : styles.feedbackSuccess}
      role={messageError ? "alert" : "status"}>{message}</p> : null}
    {loading && !dashboard ? <p className={styles.empty} role="status">Cargando el período financiero…</p> : null}

    {summary ? <>
      <div className={styles.financeMetrics}>
        {canManage ? <>
          <article className={styles.financeMetric}><span>Ingresos del mes</span><strong>{formatMoney(summary.incomeTotal)}</strong></article>
          <article className={styles.financeMetric}><span>Egresos del mes</span><strong>{formatMoney(summary.expenseTotal)}</strong></article>
          <article className={styles.financeMetric}><span>Balance del mes</span><strong>{formatMoney(summary.balance)}</strong></article>
          <article className={styles.financeMetric}><span>Cuotas pendientes</span><strong>{formatMoney(summary.duesOutstanding)}</strong></article>
        </> : <>
          <article className={styles.financeMetric}><span>Tus aportes del mes</span><strong>{formatMoney(summary.incomeTotal)}</strong></article>
          <article className={styles.financeMetric}><span>Cuota del mes</span><strong>{formatMoney(summary.duesTotal)}</strong></article>
          <article className={styles.financeMetric}><span>Abonado</span><strong>{formatMoney(summary.duesPaid)}</strong></article>
          <article className={styles.financeMetric}><span>Pendiente</span><strong>{formatMoney(summary.duesOutstanding)}</strong></article>
        </>}
      </div>

      <section className={styles.financeSection} aria-labelledby="finance-dues-title">
        <div className={styles.financeSectionHeader}>
          <div><p className={styles.cardLabel}>Aportes mensuales</p><h3 id="finance-dues-title">Cuotas de {formatMonth(month)}</h3></div>
          <span className={styles.financeCount}>{summary.duesCount} {summary.duesCount === 1 ? "cuota" : "cuotas"}</span>
        </div>
        {dues.length > 0 ? <div className={styles.financeDueList}>
          {dues.map((due) => {
            const dueAmount = currencyNumber(due.amountDue);
            const paidAmount = currencyNumber(due.amountPaid);
            const remaining = Math.max(0, dueAmount - paidAmount);
            const status = remaining <= 0 ? "Pagada" : paidAmount > 0 ? "Parcial" : "Pendiente";
            return <article className={styles.financeDueRow} key={due.id}>
              <div className={styles.financeDueIdentity}>
                <strong>{canManage ? due.memberName : "Tu aporte"}</strong>
                <span>{formatMoney(due.amountPaid)} de {formatMoney(due.amountDue)} · {status}</span>
              </div>
              {canManage && remaining > 0 ? <details className={styles.financePaymentDetails}>
                <summary>Registrar pago</summary>
                <form className={styles.financePaymentForm} onSubmit={(event) => handleMonthlyPayment(event, due.id)}>
                  <label>Monto<input name="paymentAmount" type="number" min="0.01" max={remaining.toFixed(2)} step="0.01" defaultValue={remaining.toFixed(2)} required /></label>
                  <label>Fecha<input name="paymentDate" type="date" defaultValue={today()} required /></label>
                  <label>Medio<select name="paymentMethod" defaultValue="cash">{Object.entries(financePaymentMethodLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                  <label>Referencia<input name="receiptReference" maxLength={120} placeholder="Opcional" /></label>
                  <button className={styles.smallButton} disabled={pending}>Guardar pago</button>
                </form>
              </details> : <strong className={styles.financeDueAmount}>{formatMoney(due.amountDue)}</strong>}
            </article>;
          })}
        </div> : <p className={styles.empty}>{canManage
          ? "No hay cuotas generadas para este mes."
          : "El club todavía no ha generado tu cuota de este mes."}</p>}
      </section>

      {canManage ? <div className={styles.financeManagementGrid}>
        <form className={styles.financeForm} onSubmit={handleGenerateDues}>
          <p className={styles.cardLabel}>Cuotas del mes</p><h3>Generar aportes</h3>
          <p className={styles.empty}>Crea una cuota por cada membresía activa. Si ya existe, se conserva y no se duplica.</p>
          <label>Mes<input name="duesMonth" type="month" value={month} onChange={(event) => { setLoading(true); setMonth(event.target.value); }} required /></label>
          <label>Monto por miembro<input name="amountDue" type="number" min="0.01" step="0.01" placeholder="0.00" required /></label>
          <button className={styles.button} disabled={pending}>{pending ? "Procesando…" : "Generar cuotas"}</button>
        </form>

        <form className={styles.financeForm} onSubmit={handleEntry}>
          <p className={styles.cardLabel}>Libro financiero</p><h3>Registrar movimiento</h3>
          <label>Tipo de movimiento<select value={category} onChange={(event) => setCategory(event.target.value as FinanceEntryCategory)}>
            <optgroup label="Ingresos">{incomeCategories.map((item) => <option key={item} value={item}>{financeCategoryLabels[item]}</option>)}</optgroup>
            <optgroup label="Egresos">{expenseCategories.map((item) => <option key={item} value={item}>{financeCategoryLabels[item]}</option>)}</optgroup>
          </select></label>
          <label>Monto<input name="amount" type="number" min="0.01" step="0.01" placeholder="0.00" required /></label>
          <label>Fecha<input name="occurredOn" type="date" defaultValue={today()} required /></label>
          <label>Descripción<input name="description" minLength={3} maxLength={500} required /></label>
          <label>Miembro relacionado<select name="memberId" defaultValue=""><option value="">Sin miembro asociado</option>
            {(dashboard?.members ?? []).map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
          </select></label>
          {category === "donation" ? <label>Donante externo<input name="counterpartyName" maxLength={120} placeholder="Opcional" /></label> : null}
          {category === "activity_contribution" || category === "activity_expense" ? <label>Actividad<select name="activityId" required defaultValue=""><option value="" disabled>Selecciona una actividad</option>
            {(dashboard?.activities ?? []).map((activity) => <option key={activity.id} value={activity.id}>{activity.name}</option>)}
          </select></label> : null}
          <label>Medio<select name="paymentMethod" defaultValue="cash">{Object.entries(financePaymentMethodLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label>Referencia<input name="receiptReference" maxLength={120} placeholder="Opcional" /></label>
          <button className={styles.button} disabled={pending}>{pending ? "Guardando…" : "Registrar movimiento"}</button>
        </form>
      </div> : null}

      <section className={styles.financeSection} aria-labelledby="finance-ledger-title">
        <div className={styles.financeSectionHeader}>
          <div><p className={styles.cardLabel}>{canManage ? "Libro del club" : "Tu historial"}</p><h3 id="finance-ledger-title">Movimientos de {formatMonth(month)}</h3></div>
          <span className={styles.financeCount}>{entries.length} {entries.length === 1 ? "movimiento" : "movimientos"}</span>
        </div>
        {entries.length > 0 ? <div className={styles.financeLedger}>
          {entries.map((entry) => <article className={styles.financeLedgerRow} key={entry.id}>
            <div className={styles.financeLedgerDate}>{formatDate(entry.occurredOn)}</div>
            <div className={styles.financeLedgerDescription}>
              <strong>{entry.description}</strong>
              <span><CategoryLabel category={entry.category} />{entry.activityName ? ` · ${entry.activityName}` : ""}</span>
              {canManage && (entry.memberName || entry.counterpartyName) ? <small>{entry.memberName ?? entry.counterpartyName}</small> : null}
            </div>
            <div className={entry.direction === "income" ? styles.financeIncome : styles.financeExpense}>
              {entry.direction === "income" ? "+" : "−"}{formatMoney(entry.amount)}
            </div>
          </article>)}
        </div> : <p className={styles.empty}>No hay movimientos registrados para este período.</p>}
        {entries.length === 100 ? <p className={styles.financeFootnote}>Se muestran los 100 movimientos más recientes del período.</p> : null}
      </section>
      {loading ? <p className={styles.financeFootnote} role="status">Actualizando Finanzas…</p> : null}
      <p className={styles.financeFootnote}>Los registros financieros no se eliminan desde la plataforma; cualquier corrección queda como un nuevo movimiento auditable.</p>
    </> : null}
  </section>;
}
