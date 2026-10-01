"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { financeCategoryLabels, financePaymentMethodLabels, type FinanceDashboard, type FinanceEntryCategory, type FinancePaymentMethod } from "@/lib/finance";
import { createFinanceEntryAction, createFinanceMonthlyDuesAction, getFinanceDashboardAction, recordFinanceMonthlyPaymentAction } from "./actions";
import styles from "./platform.module.css";
import ui from "./finance-workspace.module.css";

const incomeCategories: FinanceEntryCategory[] = ["activity_contribution", "donation", "other_income"];
const expenseCategories: FinanceEntryCategory[] = ["activity_expense", "operating_expense", "other_expense"];
function localDate() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santo_Domingo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  return ["year", "month", "day"].map(type => parts.find(part => part.type === type)?.value).join("-");
}
function periodDate(month: string) { return month >= localDate().slice(0,7) ? localDate() : `${month}-01`; }
function money(value: string | number) { return new Intl.NumberFormat("es-DO", { style: "currency", currency: "DOP" }).format(Number(value)); }
function date(value: string) { return new Intl.DateTimeFormat("es-DO", { day: "2-digit", month: "2-digit", year: "2-digit", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`)); }
function methods() { return Object.entries(financePaymentMethodLabels).map(([value,label]) => <option key={value} value={value}>{label}</option>); }

export function FinanceModule({ canManage, onOpenActivities }: { canManage: boolean; onOpenActivities: () => void }) {
  const [month, setMonth] = useState(() => localDate().slice(0,7));
  const [memberId, setMemberId] = useState("");
  const [activityId, setActivityId] = useState("");
  const [page, setPage] = useState(0);
  const [view, setView] = useState<"ledger" | "dues">("ledger");
  const [dashboard, setDashboard] = useState<FinanceDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);
  const [category, setCategory] = useState<FinanceEntryCategory>("other_income");
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const [duesAmount, setDuesAmount] = useState("");
  const [entryOpen, setEntryOpen] = useState(false);
  const [entryDate, setEntryDate] = useState(localDate);
  const latest = useRef(0);

  useEffect(() => {
    const request = ++latest.current;
    let active = true;
    void getFinanceDashboardAction(month, { memberId, activityId, page }).then(result => {
      if (!active || request !== latest.current) return;
      setDashboard(result.ok ? result.dashboard ?? null : null);
      if (!result.ok) { setFeedback(result.message); setError(true); }
      setLoading(false);
    }).catch(() => {
      if (!active) return;
      setDashboard(null); setLoading(false); setFeedback("No se pudieron cargar las finanzas. Usa Volver a cargar para intentarlo nuevamente."); setError(true);
    });
    return () => { active = false; };
  }, [month, memberId, activityId, page, reload]);

  function changeFilter(field: "month" | "member" | "activity", value: string) {
    setLoading(true); setPage(0); setFeedback("");
    if (field === "month") { setMonth(value); setEntryDate(periodDate(value)); setSelectedMembers([]); }
    else if (field === "member") setMemberId(value);
    else setActivityId(value);
  }
  async function save(action: Promise<{ok:boolean;message:string}>, onSuccess?: () => void) {
    setPending(true); setFeedback("");
    try {
      const result = await action;
      setFeedback(result.message); setError(!result.ok);
      if (result.ok) { onSuccess?.(); setLoading(true); setReload(n => n+1); }
    } catch { setFeedback("No se pudo guardar. Tus datos siguen en el formulario; vuelve a intentarlo."); setError(true); }
    finally { setPending(false); }
  }
  function handleEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form=event.currentTarget; const data=new FormData(form);
    const occurredOn=String(data.get("occurredOn"));
    const entryMemberId=String(data.get("memberId") || "");
    const entryActivityId=String(data.get("activityId") || "");
    void save(createFinanceEntryAction({ category, amount:String(data.get("amount")), occurredOn, description:String(data.get("description")), memberId:String(data.get("memberId") || "") || undefined,
      counterpartyName:String(data.get("counterpartyName") || "") || undefined, activityId:String(data.get("activityId") || "") || undefined,
      paymentMethod:String(data.get("paymentMethod")) as FinancePaymentMethod, receiptReference:String(data.get("receiptReference") || "") || undefined }),
      () => { form.reset(); setEntryOpen(false); setPage(0);
        if(occurredOn.slice(0,7)!==month) { setMonth(occurredOn.slice(0,7)); setSelectedMembers([]); }
        if(memberId && entryMemberId!==memberId) setMemberId("");
        if(activityId && entryActivityId!==activityId) setActivityId("");
      });
  }
  function handleDues(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void save(createFinanceMonthlyDuesAction({ month, amountDue:duesAmount, memberIds:selectedMembers }), () => { setSelectedMembers([]); setDuesAmount(""); });
  }
  function handlePayment(event: FormEvent<HTMLFormElement>, dueId:string) {
    event.preventDefault(); const form=event.currentTarget; const data=new FormData(form);
    void save(recordFinanceMonthlyPaymentAction({ dueId, amount:String(data.get("amount")), occurredOn:String(data.get("occurredOn")), paymentMethod:String(data.get("paymentMethod")) as FinancePaymentMethod, receiptReference:String(data.get("receiptReference") || "") || undefined }),
      () => { form.reset(); form.closest("details")?.removeAttribute("open"); });
  }
  function metricMoney(value: string | number) { return loading ? "…" : money(value); }
  const filtered = Boolean(memberId || activityId);
  const income=filtered ? dashboard?.scope.income : dashboard?.summary.incomeTotal;
  const expense=filtered ? dashboard?.scope.expense : dashboard?.summary.expenseTotal;
  const dues=(dashboard?.dues ?? []).filter(due => !memberId || due.memberId===memberId);
  const availableMembers=(dashboard?.members ?? []).filter(member => member.active !== false && !(dashboard?.dues ?? []).some(due => due.memberId===member.id));

  return <section className={ui.workspace} aria-label="Finanzas del club">
    <header className={ui.heading}><div><h2>{canManage ? "Ingresos y egresos del club" : "Mis aportes"}</h2><p>Registra lo recibido y lo gastado. Vincula cada movimiento con un miembro, una actividad o una persona externa.</p></div>
      <label>Período<input type="month" required value={month} disabled={pending || loading} onChange={e => { if(e.target.value) changeFilter("month",e.target.value); }} /></label></header>
    {month === "2000-01" ? <p className={ui.demo}>Período de prueba · Los miembros, importes y actividad que dicen «Prueba» son ficticios. <button onClick={() => changeFilter("month",localDate().slice(0,7))}>Volver al mes actual</button></p> : canManage ? <button className={ui.demoLink} onClick={() => changeFilter("month","2000-01")}>Ver ejemplo con miembros de prueba ↗</button> : null}
    {feedback ? <p className={error ? styles.feedbackError : styles.feedbackSuccess} role={error ? "alert" : "status"}>{feedback}</p> : null}
    <div className={ui.toolbar}><div className={ui.views}><button aria-pressed={view==="ledger"} onClick={() => setView("ledger")}>Movimientos</button><button aria-pressed={view==="dues"} onClick={() => { setView("dues"); if(activityId) changeFilter("activity", ""); }}>Cuotas por miembro</button></div>
      {canManage ? <button className={styles.button} onClick={() => { setView("ledger"); if(!entryOpen) setEntryDate(periodDate(month)); setEntryOpen(value => !value); }} aria-expanded={entryOpen}>+ Registrar ingreso o egreso</button> : null}</div>
    {canManage ? <div className={ui.filters}><label>Miembro<select value={memberId} disabled={pending || loading} onChange={e => changeFilter("member",e.target.value)}><option value="">Todos los miembros</option>{dashboard?.members.map(m => <option value={m.id} key={m.id}>{m.name}{m.active === false ? " (sin membresía activa)" : ""}</option>)}</select></label>
      {view==="ledger" ? <label>Actividad<select value={activityId} disabled={pending || loading} onChange={e => changeFilter("activity",e.target.value)}><option value="">Todas las actividades</option>{dashboard?.activities.map(a => <option value={a.id} key={a.id}>{a.name}</option>)}</select></label> : null}
      {filtered ? <button className={styles.buttonQuiet} onClick={() => {setLoading(true);setMemberId("");setActivityId("");setPage(0);}}>Limpiar filtros</button> : null}</div> : null}
    {loading ? <p role="status" className={styles.empty}>Cargando el período financiero…</p> : null}
    {!loading && !dashboard ? <button className={styles.buttonQuiet} onClick={() => {setLoading(true);setReload(n=>n+1);}}>Volver a cargar</button> : null}
    {dashboard ? <>
      <div className={styles.financeMetrics} aria-busy={loading}>
        <article className={styles.financeMetric}><span>{canManage ? filtered ? "Ingresos del filtro" : "Ingresos del mes" : "Mis aportes del mes"}</span><strong>{metricMoney(income ?? "0")}</strong></article>
        {canManage ? <><article className={styles.financeMetric}><span>{filtered ? "Egresos del filtro" : "Egresos del mes"}</span><strong>{metricMoney(expense ?? "0")}</strong></article><article className={styles.financeMetric}><span>{filtered ? "Balance del filtro" : "Balance del mes"}</span><strong>{metricMoney(Number(income)-Number(expense))}</strong></article></> : <><article className={styles.financeMetric}><span>Cuota del mes</span><strong>{metricMoney(dashboard.summary.duesTotal)}</strong></article><article className={styles.financeMetric}><span>Abonado a cuota</span><strong>{metricMoney(dashboard.summary.duesPaid)}</strong></article></>}
        <article className={styles.financeMetric}><span>Cuotas pendientes{memberId ? " del miembro" : " del mes"}</span><strong>{metricMoney(memberId ? dues.reduce((total,due)=>total+Math.max(0,Number(due.amountDue)-Number(due.amountPaid)),0) : dashboard.summary.duesOutstanding)}</strong></article>
      </div>
      {view==="ledger" && entryOpen && canManage ? <form className={ui.entryForm} onSubmit={handleEntry}>
        <div className={ui.formHeading}><h3>Registrar ingreso o egreso</h3><button type="button" className={styles.buttonQuiet} onClick={()=>setEntryOpen(false)}>Cerrar formulario</button></div>
        <div className={ui.formGrid}>
          <label>Tipo de movimiento<select value={category} onChange={e=>setCategory(e.target.value as FinanceEntryCategory)}><optgroup label="Ingresos">{incomeCategories.map(c=><option key={c} value={c}>{financeCategoryLabels[c]}</option>)}</optgroup><optgroup label="Egresos">{expenseCategories.map(c=><option key={c} value={c}>{financeCategoryLabels[c]}</option>)}</optgroup></select></label>
          <label>Monto (RD$)<input name="amount" type="number" required min="0.01" step="0.01" placeholder="0.00" /></label>
          <label>Fecha del movimiento<input name="occurredOn" type="date" required max={localDate()} value={entryDate} onChange={event=>setEntryDate(event.target.value)} /></label>
          <label>{category.endsWith("expense") ? "Miembro que realizó el gasto" : "Miembro que aporta"}<select name="memberId" defaultValue={memberId}><option value="">Sin miembro / persona externa</option>{dashboard.members.map(m=><option key={m.id} value={m.id}>{m.name}{m.active === false ? " (sin membresía activa)" : ""}</option>)}</select></label>
          <label>Actividad{category.startsWith("activity_") ? " (obligatoria)" : " (opcional)"}<select name="activityId" required={category.startsWith("activity_")} defaultValue={activityId}><option value="">{category.startsWith("activity_") ? "Selecciona la actividad" : "Sin actividad asociada"}</option>{dashboard.activities.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
          <label>{category.endsWith("expense") ? "Proveedor o destinatario" : "Donante o aportante externo"}<input name="counterpartyName" maxLength={120} placeholder="Nombre de la persona o entidad, si aplica" /></label>
          <label className={ui.wide}>Concepto / descripción<input name="description" required minLength={3} maxLength={500} placeholder="Ej. Aporte de Ana para materiales de la jornada" /></label>
          <label>Medio de pago<select name="paymentMethod" defaultValue="cash">{methods()}</select></label><label>Referencia / recibo<input name="receiptReference" maxLength={120} placeholder="Opcional" /></label>
        </div>
        {dashboard.activities.length===0 ? <p>No hay actividades registradas. <button type="button" className={ui.demoLink} onClick={onOpenActivities}>Crear una actividad ↗</button></p> : null}
        <button className={styles.button} disabled={pending || loading}>{pending ? "Guardando…" : "Guardar movimiento"}</button>
      </form> : null}
      {loading ? null : view==="ledger" ? <section className={ui.panel} aria-busy={loading}><div className={ui.formHeading}><h3>Libro de movimientos</h3><span>{dashboard.scope.count} registros · período {month}</span></div>
        <p className={ui.help}>Los totales incluyen todo el período y los filtros seleccionados. Los pagos de cuotas se registran desde «Cuotas por miembro».</p>
        {dashboard.entries.length ? <div className={ui.tableScroll}><table><thead><tr><th>Fecha</th><th>Concepto</th><th>Miembro / persona</th><th>Actividad</th><th>Ingreso</th><th>Egreso</th><th>Medio / referencia</th></tr></thead><tbody>{dashboard.entries.map(entry=><tr key={entry.id}><td>{date(entry.occurredOn)}</td><td><strong>{entry.description}</strong><small>{financeCategoryLabels[entry.category]}</small></td><td>{entry.memberName ?? entry.counterpartyName ?? "Club"}{entry.memberName && entry.counterpartyName ? <small>{entry.counterpartyName}</small> : null}</td><td>{entry.activityName ?? "—"}</td><td className={ui.income}>{entry.direction==="income" ? money(entry.amount) : "—"}</td><td className={ui.expense}>{entry.direction==="expense" ? money(entry.amount) : "—"}</td><td>{financePaymentMethodLabels[entry.paymentMethod]}<small>{entry.receiptReference ?? "Sin referencia"}</small></td></tr>)}</tbody></table></div> : <p className={styles.empty}>No hay movimientos para este período y estos filtros. Registra el primer ingreso o egreso con el botón superior.</p>}
        {dashboard.scope.count>50 ? <div className={ui.pagination}><button className={styles.buttonQuiet} disabled={loading || page===0} onClick={()=>{setLoading(true);setPage(p=>p-1);}}>Anterior</button><span>Página {page+1} de {Math.ceil(dashboard.scope.count/50)}</span><button className={styles.buttonQuiet} disabled={loading || (page+1)*50>=dashboard.scope.count} onClick={()=>{setLoading(true);setPage(p=>p+1);}}>Siguiente</button></div> : null}
      </section> : <>
        <section className={ui.panel}><h3>Cuotas individuales · {month}</h3><p className={ui.help}>Cada fila corresponde a un miembro. Asignar la cuota crea una obligación; el ingreso se registra cuando recibes un pago.</p>
          {dues.map(due=>{const remaining=Math.max(0,Number(due.amountDue)-Number(due.amountPaid));return <article className={ui.due} key={due.id}><div><strong>{due.memberName}</strong><span>Cuota: {money(due.amountDue)} · Pagado: {money(due.amountPaid)} · Pendiente: {money(remaining)}</span><small>{remaining===0 ? "Pagada" : Number(due.amountPaid)>0 ? "Pago parcial" : "Pendiente"}</small></div>{canManage && remaining>0 ? <details><summary>Registrar pago de {due.memberName}</summary><form className={ui.payment} onSubmit={e=>handlePayment(e,due.id)}><label>Monto (RD$)<input name="amount" type="number" min="0.01" step="0.01" max={remaining} defaultValue={remaining} required /></label><label>Fecha<input name="occurredOn" type="date" max={localDate()} defaultValue={month==="2000-01" ? "2000-01-15" : localDate()} required /></label><label>Medio<select name="paymentMethod" defaultValue="cash">{methods()}</select></label><label>Referencia<input name="receiptReference" maxLength={120} /></label><button className={styles.button} disabled={pending || loading}>Guardar pago</button></form></details> : null}</article>;})}
          {!dues.length ? <p className={styles.empty}>No se han asignado cuotas a los miembros de esta selección para {month}.</p> : null}
        </section>
        {canManage ? <form className={ui.panel} onSubmit={handleDues}><h3>Asignar cuota a miembros</h3><p className={ui.help}>Selecciona a quién corresponde y el monto de cada persona. Puedes repetir este paso con otros miembros e importes. Las cuotas existentes se conservan.</p><label>Monto por cada miembro (RD$)<input type="number" min="0.01" step="0.01" required value={duesAmount} onChange={e=>setDuesAmount(e.target.value)} /></label>
          <fieldset className={ui.memberPicker}><legend>Miembros activos sin cuota en {month}</legend><button type="button" className={styles.buttonQuiet} onClick={()=>setSelectedMembers(selectedMembers.length===availableMembers.length ? [] : availableMembers.map(m=>m.id))}>{selectedMembers.length===availableMembers.length && availableMembers.length ? "Quitar selección" : "Seleccionar todos"}</button>
          {availableMembers.map(member=><label key={member.id}><input type="checkbox" checked={selectedMembers.includes(member.id)} onChange={e=>setSelectedMembers(ids=>e.target.checked ? [...ids,member.id] : ids.filter(id=>id!==member.id))} />{member.name}</label>)}{!availableMembers.length ? <p>Todos los miembros disponibles ya tienen cuota para este mes.</p> : null}</fieldset>
          <p className={ui.assignment}>Se asignarán {selectedMembers.length} cuotas individuales de {money(duesAmount || 0)}. Total de obligaciones: {money(selectedMembers.length*Number(duesAmount || 0))}.</p><button className={styles.button} disabled={pending || loading || !selectedMembers.length}>{pending ? "Asignando…" : "Asignar cuotas a los seleccionados"}</button></form> : null}
      </>}
      <p className={ui.help}>Los registros conservan su historial. Para corregir un importe, registra un movimiento compensatorio y explica la referencia del registro original.</p>
    </> : null}
  </section>;
}
