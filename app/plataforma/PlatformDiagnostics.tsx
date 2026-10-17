"use client";

import { useEffect, useState } from "react";
import { diagnosticCodes, diagnosticScopes, type DiagnosticEvent } from "@/lib/diagnostics";
import styles from "./diagnostics.module.css";

type Report = { events: DiagnosticEvent[]; checkedAt: string; health: { authMs: number; databaseMs: number; storage: string }; retentionDays: number; maxEvents: number };
const scopeLabels: Record<string, string> = { login: "Inicio de sesión", recovery: "Recuperación", password: "Contraseña", signup: "Registro", confirmation: "Confirmación", browser: "Navegador", backend: "Base de datos", server: "Servidor", test: "Prueba" };
function date(value: string) {
  return new Intl.DateTimeFormat("es-DO", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", timeZone: "America/Santo_Domingo" }).format(new Date(value)).replace(",", "");
}
export function PlatformDiagnostics() {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [scope, setScope] = useState("");
  const [source, setSource] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [testBusy, setTestBusy] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setBusy(true); setError("");
      try {
        const response = await fetch("/api/diagnostics", { cache: "no-store", signal: controller.signal });
        const denied = response.status === 403 ? await response.json().catch(() => ({})) as { error?: string } : {};
        if (!response.ok) throw new Error(denied.error === "mfa_required" ? "Confirma tu verificación en dos pasos en «Seguridad de la cuenta» para consultar el diagnóstico." : response.status === 403 ? "Solo administradores activos pueden consultar el diagnóstico." : response.status === 401 ? "Tu sesión venció. Vuelve a iniciar sesión." : "No se pudo consultar el registro. Comprueba el backend y los permisos del almacenamiento.");
        setReport(await response.json());
      } catch (cause) {
        if (!controller.signal.aborted) { setReport(null); setError(cause instanceof Error ? cause.message : "No se pudo cargar el diagnóstico."); }
      } finally { if (!controller.signal.aborted) setBusy(false); }
    }
    void load();
    return () => controller.abort();
  }, [refresh]);

  async function test() {
    setTestBusy(true); setNotice("");
    try {
      const response = await fetch("/api/diagnostics", { method: "PUT" });
      if (!response.ok) throw new Error("No se pudo guardar la prueba de diagnóstico.");
      const { id } = await response.json();
      setNotice(`Prueba registrada. Referencia: ${id}`); setRefresh(value => value + 1);
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : "Prueba no disponible."); }
    finally { setTestBusy(false); }
  }

  const filtered = (report?.events || []).filter(event => (!scope || event.scope === scope) && (!source || event.source === source) &&
    `${event.id} ${event.code} ${diagnosticCodes[event.code]?.[0]} ${event.path} ${event.serviceCode || ""} ${event.digest || ""} ${event.reactCode || ""}`.toLowerCase().includes(query.trim().toLowerCase()));
  const pages = Math.max(1, Math.ceil(filtered.length / 25));
  const currentPage = Math.min(page, pages - 1);
  const detail = filtered.find(event => event.id === selected);
  function exportReport() {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ checkedAt: report?.checkedAt, events: filtered }, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "club-diagnostico.json"; anchor.click(); URL.revokeObjectURL(url);
  }

  return <section className={styles.root} aria-label="Diagnóstico de la plataforma">
    <div className={styles.toolbar}><p>Errores y estado del sistema <span>Solo administración</span></p><div><button disabled={busy} onClick={() => setRefresh(value => value + 1)}>{busy ? "Comprobando…" : "Actualizar y comprobar"}</button><button disabled={!report || busy || testBusy} onClick={test}>{testBusy ? "Registrando…" : "Probar registro"}</button><button disabled={!report || busy} onClick={exportReport}>Exportar selección</button></div></div>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {notice && <p role="status" className={styles.notice}>{notice}</p>}
    {report && <>
      <div className={styles.health} aria-label="Comprobaciones actuales">
        <article><span>Auth · sesión validada</span><strong>Disponible</strong><small>{report.health.authMs} ms</small></article>
        <article><span>Base de datos · membresía</span><strong>Disponible</strong><small>{report.health.databaseMs} ms</small></article>
        <article><span>Registro de incidencias</span><strong>{report.events.filter(event => event.code !== "test_event").length} incidencias</strong><small>{report.events.filter(event => event.code === "test_event").length} pruebas aparte</small></article>
      </div>
      <p className={styles.caption}>Comprobado: {date(report.checkedAt)} · Santo Domingo. Ventana de {report.retentionDays} días, hasta {report.maxEvents} registros recientes. Las comprobaciones corresponden a esta sesión y al backend; el estado de otros dispositivos puede variar.</p>
      <div className={styles.filters}>
        <label>Módulo<select value={scope} onChange={event => { setScope(event.target.value); setPage(0); }}><option value="">Todos</option>{diagnosticScopes.map(value => <option key={value} value={value}>{scopeLabels[value]}</option>)}</select></label>
        <label>Origen<select value={source} onChange={event => { setSource(event.target.value); setPage(0); }}><option value="">Todos</option><option value="server">Servidor</option><option value="client">Navegador (reporte)</option></select></label>
        <label className={styles.search}>Buscar referencia, código o ruta<input type="search" value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} placeholder="Referencia o código técnico" /></label>
      </div>
      <div className={styles.tableWrap}><table><caption className={styles.caption}>Incidencias registradas desde la activación del diagnóstico</caption><thead><tr><th>Fecha y hora</th><th>Módulo</th><th>Incidencia</th><th>Origen / HTTP</th><th>Referencia</th><th>Detalle</th></tr></thead><tbody>
        {filtered.slice(currentPage * 25, currentPage * 25 + 25).map(event => <tr key={event.id}><td><time dateTime={event.createdAt}>{date(event.createdAt)}</time></td><td>{scopeLabels[event.scope]}</td><td><strong>{diagnosticCodes[event.code][0]}</strong><small>{event.code}{event.serviceCode ? ` · ${event.serviceCode}` : ""}{event.reactCode ? ` · React #${event.reactCode}` : ""}</small></td><td>{event.source === "server" ? "Servidor" : "Navegador (reporte)"}{event.status ? ` / ${event.status}` : ""}</td><td><code title={event.id}>{event.id.slice(0, 8)}</code></td><td><button aria-expanded={selected === event.id} onClick={() => setSelected(selected === event.id ? null : event.id)}>Ver detalle</button></td></tr>)}
        {filtered.length === 0 && <tr><td colSpan={6}>No hay incidencias que coincidan. Usa «Probar registro» para comprobar la captura.</td></tr>}
      </tbody></table></div>
      <div className={styles.pagination}><span>{filtered.length} registros · página {currentPage + 1} de {pages}</span><button disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Anterior</button><button disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>Siguiente</button></div>
      {detail && <section className={styles.detail} aria-label="Detalle de incidencia"><h3>{diagnosticCodes[detail.code][0]}</h3><dl><dt>Referencia completa</dt><dd><code>{detail.id}</code></dd><dt>Fecha / módulo</dt><dd>{date(detail.createdAt)} · {scopeLabels[detail.scope]}</dd><dt>Código / HTTP</dt><dd>{detail.code} · {detail.serviceCode || "Sin código de servicio"} · {detail.status || "Sin estado HTTP"}</dd>{detail.reactCode && <><dt>Código de React</dt><dd>#{detail.reactCode}</dd></>}<dt>Ruta / operación</dt><dd>{detail.path} · {detail.operation || "Navegador"}</dd><dt>Versión de la aplicación</dt><dd>{detail.release}</dd><dt>Origen</dt><dd>{detail.source === "client" ? `Reporte del navegador (${detail.browser}); no confirma por sí solo la causa en el servidor.` : "Capturado por el servidor."}</dd>{detail.digest && <><dt>Digest de Next.js</dt><dd>{detail.digest}</dd></>}{!!detail.frames?.length && <><dt>Posiciones en código compilado</dt><dd>{detail.frames.join(", ")}</dd></>}<dt>Siguiente comprobación</dt><dd>{diagnosticCodes[detail.code][1]}</dd></dl></section>}
    </>}
    <p className={styles.caption}>Se excluyen correos, contraseñas, tokens, cookies, consultas y contenido de formularios. Los fallos de conexión que impidan enviar un reporte no pueden aparecer aquí. Este registro empieza con su activación y no reconstruye errores anteriores.</p>
  </section>;
}
