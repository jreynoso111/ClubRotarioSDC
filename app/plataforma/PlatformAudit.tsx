"use client";

import { useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import type { FormEvent } from "react";
import {
  auditActionLabel, auditFieldLabels, auditModules, auditTableLabels, auditValue, defaultAuditFilters,
  defaultAuditSort, formatAuditDate, parseAuditDateInput,
  type AuditDetail, type AuditEntry, type AuditFilters, type AuditPageResult, type AuditSort, type AuditSortColumn,
} from "@/lib/audit";
import { auditColumns, defaultAuditLayout, moveAuditColumn, readAuditLayout, type AuditTableLayout } from "@/lib/audit-table";
import { getAuditDetailAction, getAuditPageAction } from "./actions";
import styles from "./platform.module.css";

const roleLabels: Record<string, string> = {
  admin: "Administración", club_manager: "Gestión del club", coordinator: "Coordinación",
  editor: "Edición", member: "Miembro", system: "Sistema",
};
const sourceLabels: Record<string, string> = {
  database: "Plataforma", storage: "Archivos", authentication: "Autenticación", system: "Sistema",
};
const layoutKey = "rotary:audit-columns:v1";
const layoutEvent = "rotary-audit-columns";
let sessionLayout: string | null = null;
function getLayoutSnapshot() {
  if (sessionLayout !== null) return sessionLayout;
  try { return window.localStorage.getItem(layoutKey); }
  catch { return sessionLayout; }
}
function subscribeLayout(listener: () => void) {
  window.addEventListener("storage", listener);
  window.addEventListener(layoutEvent, listener);
  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener(layoutEvent, listener);
  };
}
function saveLayout(layout: AuditTableLayout) {
  const serialized = JSON.stringify(layout);
  try { window.localStorage.setItem(layoutKey, serialized); sessionLayout = null; }
  catch { sessionLayout = serialized; }
  window.dispatchEvent(new Event(layoutEvent));
}
function getServerLayoutSnapshot() { return null; }

function AuditColumnMenu({ layout, onChange }: { layout: AuditTableLayout; onChange: (layout: AuditTableLayout) => void }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    function closeOutside(event: PointerEvent) {
      if (ref.current?.open && event.target instanceof Node && !ref.current.contains(event.target)) ref.current.open = false;
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && ref.current?.open) ref.current.open = false;
    }
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);
  return <details ref={ref} className={styles.auditColumnMenu}>
    <summary className={styles.smallButtonQuiet}>Columnas</summary>
    <div className={styles.auditColumnPopover} aria-label="Organizar columnas">
      <p>Mostrar y ordenar columnas</p>
      <ul>{layout.order.map((id, index) => {
        const column = auditColumns.find(column => column.id === id)!;
        const visible = !layout.hidden.includes(id);
        return <li key={id}>
          <label><input type="checkbox" checked={visible}
            disabled={visible && layout.hidden.length === layout.order.length - 1}
            onChange={() => onChange({ ...layout, hidden: visible ? [...layout.hidden, id] : layout.hidden.filter(item => item !== id) })} />
            {column.label}</label>
          <div>
            <button type="button" aria-label={`Mover ${column.label} a la izquierda`} title="Mover a la izquierda"
              disabled={index === 0} onClick={() => onChange(moveAuditColumn(layout, id, -1))}>↑</button>
            <button type="button" aria-label={`Mover ${column.label} a la derecha`} title="Mover a la derecha"
              disabled={index === layout.order.length - 1} onClick={() => onChange(moveAuditColumn(layout, id, 1))}>↓</button>
          </div>
        </li>;
      })}</ul>
      <button type="button" className={styles.smallButtonQuiet} onClick={() => onChange(defaultAuditLayout)}>Restablecer columnas</button>
      <small>La distribución se guarda en este navegador.</small>
    </div>
  </details>;
}

function auditCellText(entry: AuditEntry, column: AuditSortColumn): string {
  switch (column) {
    case "occurred_at": return formatAuditDate(entry.occurred_at);
    case "actor_role": return roleLabels[entry.actor_role] ?? entry.actor_role;
    case "source": return sourceLabels[entry.source];
    case "operation": return auditActionLabel(entry);
    case "table_name": return auditTableLabels[entry.table_name] ?? entry.table_name;
    case "changed_fields": return entry.changed_fields.map(field => auditFieldLabels[field] ?? field.replaceAll("_", " ")).join(", ") || "—";
    default: return entry[column];
  }
}

function detailValue(field: string, value: unknown) {
  if (typeof value === "string" && (field.endsWith("_at") || field === "banned_until" || field === "not_after") &&
    /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value))) return formatAuditDate(value);
  return auditValue(value);
}

function AuditDetailDialog({ entry, detail, error, onClose }: {
  entry: AuditEntry; detail: AuditDetail | null; error: string | null; onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} className={`${styles.eventDialog} ${styles.auditDialog}`}
    aria-labelledby="audit-detail-title" onCancel={onClose} onClose={onClose}>
    <div className={styles.eventDialogHeader}>
      <div><p className={styles.cardLabel}>{auditActionLabel(entry)} · {auditTableLabels[entry.table_name]}</p>
        <h2 id="audit-detail-title">Detalle de auditoría</h2></div>
      <button type="button" className={styles.smallButtonQuiet} onClick={onClose} aria-label="Cerrar detalle">Cerrar</button>
    </div>
    <div className={styles.auditDetailBody}>
      <h3>{entry.entity_label}</h3>
      <p className={styles.auditDetailIntro}>{entry.actor_name} · {formatAuditDate(entry.occurred_at)} · Hora de Santo Domingo</p>
      {!detail && !error && <p role="status" className={styles.empty}>Cargando los valores del cambio…</p>}
      {error && <p role="alert" className={styles.feedbackError}>{error}</p>}
      {detail && <>
        <div className={styles.auditTableScroll}>
          <table className={styles.auditChanges}>
            <caption>Campos registrados en este cambio</caption>
            <thead><tr><th scope="col">Campo</th><th scope="col">Antes</th><th scope="col">Después</th></tr></thead>
            <tbody>{detail.changed_fields.map(field => <tr key={field}>
              <th scope="row">{auditFieldLabels[field] ?? field.replaceAll("_", " ")}</th>
              <td><pre>{detailValue(field, detail.before_data?.[field])}</pre></td>
              <td><pre>{detailValue(field, detail.after_data?.[field])}</pre></td>
            </tr>)}</tbody>
          </table>
        </div>
        <dl className={styles.auditContext}>
          <div><dt>Persona o servicio</dt><dd>{entry.actor_name} · {roleLabels[entry.actor_role] ?? entry.actor_role}</dd></div>
          {entry.actor_id && <div><dt>Identificador de la persona</dt><dd>{entry.actor_id}</dd></div>}
          <div><dt>Origen</dt><dd>{sourceLabels[entry.source]} · {entry.schema_name}.{entry.table_name}</dd></div>
          <div><dt>Identificador del registro</dt><dd>{entry.record_id}</dd></div>
          <div><dt>Transacción</dt><dd>{detail.transaction_id}</dd></div>
          {detail.context.ip_address ? <div><dt>Dirección IP</dt><dd>{auditValue(detail.context.ip_address)}</dd></div> : null}
          {detail.context.user_agent ? <div><dt>Navegador</dt><dd>{auditValue(detail.context.user_agent)}</dd></div> : null}
          {detail.context.account_user_id ? <div><dt>Cuenta relacionada</dt><dd>{auditValue(detail.context.account_user_id)}</dd></div> : null}
        </dl>
        <details className={styles.auditSnapshots}>
          <summary>Ver registro completo</summary>
          <h4>Antes</h4><pre>{auditValue(detail.before_data)}</pre>
          <h4>Después</h4><pre>{auditValue(detail.after_data)}</pre>
          <h4>Contexto</h4><pre>{auditValue(detail.context)}</pre>
        </details>
      </>}
    </div>
  </dialog>;
}

export function PlatformAudit({ initialResult, initialLoading }: {
  initialResult: AuditPageResult | null; initialLoading: boolean;
}) {
  const [result, setResult] = useState<AuditPageResult | null>(null);
  const [appliedFilters, setAppliedFilters] = useState<AuditFilters>(defaultAuditFilters);
  const [sort, setSort] = useState<AuditSort>(defaultAuditSort);
  const [filterError, setFilterError] = useState<string | null>(null);
  const [selection, setSelection] = useState<{ entry: AuditEntry; detail: AuditDetail | null; error: string | null } | null>(null);
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const current = result ?? initialResult;
  const page = current?.page;
  const busy = pending || initialLoading;
  const savedLayout = useSyncExternalStore(subscribeLayout, getLayoutSnapshot, getServerLayoutSnapshot);
  const layout = readAuditLayout(savedLayout);
  const columns = layout.order.filter(id => !layout.hidden.includes(id)).map(id => auditColumns.find(column => column.id === id)!);
  const sortLabel = auditColumns.find(column => column.id === sort.column)!.label;

  function load(filters: AuditFilters, append = false, nextSort: AuditSort = sort) {
    const cursor = append ? page?.nextCursor : null;
    startTransition(async () => {
      try {
        const response = await getAuditPageAction(filters, cursor, nextSort);
        if (response.ok && response.page) {
          setResult(append ? { ...response, page: {
            ...response.page, entries: [...(page?.entries ?? []), ...response.page.entries],
          } } : response);
          setAppliedFilters(filters);
          setSort(nextSort);
        } else setResult(response);
      } catch {
        setResult({ ok: false, message: "No se pudo consultar la auditoría. Inténtalo de nuevo." });
      }
    });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const from = parseAuditDateInput(String(data.get("from") ?? ""));
    const until = parseAuditDateInput(String(data.get("until") ?? ""));
    if (from === null || until === null || (from && until && from > until)) {
      setFilterError("Usa fechas válidas en formato DD/MM/AA y coloca Desde antes de Hasta.");
      return;
    }
    setFilterError(null);
    load({
      module: String(data.get("module")) as AuditFilters["module"],
      operation: String(data.get("operation")) as AuditFilters["operation"],
      search: String(data.get("search") ?? ""), from, until,
    });
  }

  function openDetail(entry: AuditEntry) {
    setSelection({ entry, detail: null, error: null });
    startTransition(async () => {
      try {
        const response = await getAuditDetailAction(entry.id);
        setSelection(current => current?.entry.id === entry.id ? {
          entry, detail: response.detail ?? null, error: response.ok ? null : response.message,
        } : current);
      } catch {
        setSelection(current => current?.entry.id === entry.id ? {
          ...current, error: "No se pudo cargar este detalle. Cierra e inténtalo de nuevo.",
        } : current);
      }
    });
  }

  return <section className={styles.auditPanel} aria-label="Registro de auditoría" aria-busy={busy}>
    <header className={styles.auditHeader}>
      <div><p className={styles.cardLabel}>Administración · historial protegido</p>
        <h2 className={styles.cardTitle}>Registro de auditoría.</h2>
      </div>
      <div className={styles.auditToolbar}>
        <AuditColumnMenu layout={layout} onChange={saveLayout} />
        <button type="button" className={styles.smallButtonQuiet} disabled={busy} onClick={() => load(appliedFilters)}>Actualizar</button>
      </div>
    </header>
    <form ref={formRef} className={styles.auditFilters} onSubmit={submit}>
      <label className={styles.auditSearch}>Buscar<input name="search" type="search" maxLength={120} placeholder="Persona, registro o identificador" /></label>
      <label>Módulo<select name="module" defaultValue="all">{Object.entries(auditModules).map(([value, item]) =>
        <option key={value} value={value}>{item.label}</option>)}</select></label>
      <label>Acción<select name="operation" defaultValue="all">
        <option value="all">Todas las acciones</option><option value="INSERT">Creaciones e inicios</option>
        <option value="UPDATE">Ediciones</option><option value="DELETE">Eliminaciones y cierres</option>
        <option value="ENABLE">Activación</option>
      </select></label>
      <label>Desde<input type="text" name="from" maxLength={8} placeholder="DD/MM/AA" aria-describedby="audit-date-help" /></label>
      <label>Hasta<input type="text" name="until" maxLength={8} placeholder="DD/MM/AA" aria-describedby="audit-date-help" /></label>
      <div className={styles.auditFilterActions}>
        <button className={styles.smallButton} disabled={busy}>Filtrar</button>
        <button type="button" className={styles.smallButtonQuiet} disabled={busy} onClick={() => {
          formRef.current?.reset(); setFilterError(null); load(defaultAuditFilters);
        }}>Limpiar</button>
      </div>
    </form>
    <div className={styles.auditStatus}>
      <p id="audit-date-help" className={styles.auditNote}>DD/MM/AA · Hora de Santo Domingo (24 h)</p>
      {busy && <span role="status">Consultando…</span>}
    </div>
    {filterError && <p className={styles.feedbackError} role="alert">{filterError}</p>}
    {current && !current.ok && <p className={styles.feedbackError} role="alert">{current.message}</p>}
    {page && current?.ok && <>
      <p className={styles.auditCount} aria-live="polite">{page.entries.length} {page.entries.length === 1 ? "registro" : "registros"} · {sortLabel} {sort.direction === "asc" ? "↑ ascendente" : "↓ descendente"}</p>
      <div className={styles.auditTableScroll}>
        <table className={styles.auditTable} style={{ minWidth: columns.reduce((width, column) => width + column.width, 56) }}>
          <caption>Actividad registrada en la web y la plataforma</caption>
          <colgroup>{columns.map(column => <col key={column.id} style={{ width: column.width }} />)}<col style={{ width: 56 }} /></colgroup>
          <thead><tr>{columns.map(column => {
            const nextDirection = sort.column === column.id && sort.direction === "asc" ? "desc" : "asc";
            return <th key={column.id} scope="col" aria-sort={sort.column === column.id ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}>
              <button type="button" className={styles.auditSortButton} disabled={busy}
                aria-label={`Ordenar por ${column.label}, ${nextDirection === "asc" ? "ascendente" : "descendente"}`}
                onClick={() => load(appliedFilters, false, { column: column.id, direction: nextDirection })}>
                {column.label}<span aria-hidden="true">{sort.column === column.id ? (sort.direction === "asc" ? "↑" : "↓") : "↕"}</span>
              </button>
            </th>;
          })}<th scope="col" className={styles.auditDetailColumn}>Detalle</th></tr></thead>
          <tbody>{page.entries.map(entry => <tr key={entry.id}>
            {columns.map(column => {
              const text = auditCellText(entry, column.id);
              return <td key={column.id} title={text} data-column={column.id}>
                {column.id === "occurred_at" ? <time dateTime={entry.occurred_at}>{text}</time>
                  : column.id === "operation" ? <span className={styles.auditOperation} data-operation={entry.operation}>{text}</span> : text}
              </td>;
            })}
            <td className={styles.auditDetailColumn}><button type="button" className={styles.smallButtonQuiet} disabled={busy}
              aria-label={`Ver detalle de ${entry.entity_label}, ${formatAuditDate(entry.occurred_at)}`} onClick={() => openDetail(entry)}>Ver</button></td>
          </tr>)}</tbody>
        </table>
      </div>
      {page.entries.length === 0 && <p className={styles.empty}>No hay actividad que coincida con estos filtros.</p>}
      {page.nextCursor && <div className={styles.auditMore}><button type="button" className={styles.smallButtonQuiet}
        disabled={busy} onClick={() => load(appliedFilters, true)}>Cargar más registros</button></div>}
    </>}
    {selection && <AuditDetailDialog {...selection} onClose={() => setSelection(null)} />}
  </section>;
}
