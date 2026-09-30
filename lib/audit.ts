export const auditModules = {
  all: { label: "Todos los módulos", tables: [] },
  events: { label: "Eventos y asistencia", tables: ["events", "event_rsvps"] },
  stories: { label: "Revista", tables: ["stories"] },
  membership: { label: "Miembros y solicitudes", tables: ["profiles", "memberships", "access_requests"] },
  proposals: { label: "Propuestas", tables: ["proposals"] },
  organization: { label: "Comités", tables: ["committees", "committee_members"] },
  activities: { label: "Actividades y tareas", tables: ["activities", "tasks"] },
  messaging: { label: "Mensajes y avisos", tables: ["internal_messages", "internal_message_recipients", "notifications"] },
  settings: { label: "Configuración de la web", tables: ["site_settings"] },
  media: { label: "Archivos", tables: ["media_assets", "objects"] },
  authentication: { label: "Cuentas y sesiones", tables: ["users", "sessions"] },
  system: { label: "Sistema de auditoría", tables: ["audit_log"] },
} as const;

export type AuditModule = keyof typeof auditModules;
export type AuditOperation = "INSERT" | "UPDATE" | "DELETE" | "ENABLE";
export type AuditSource = "database" | "storage" | "authentication" | "system";
export type AuditFilters = {
  module: AuditModule;
  operation: "all" | AuditOperation;
  search: string;
  from: string;
  until: string;
};
export const defaultAuditFilters: AuditFilters = {
  module: "all", operation: "all", search: "", from: "", until: "",
};
export const auditSortColumns = [
  "occurred_at", "actor_name", "actor_role", "operation", "table_name", "entity_label", "changed_fields", "source",
] as const;
export type AuditSortColumn = typeof auditSortColumns[number];
export type AuditSort = { column: AuditSortColumn; direction: "asc" | "desc" };
export const defaultAuditSort: AuditSort = { column: "occurred_at", direction: "desc" };
export type AuditCursor = {
  time: string; id: string;
  column?: AuditSortColumn; direction?: AuditSort["direction"]; value?: string | string[];
};
export type AuditEntry = {
  id: string;
  occurred_at: string;
  actor_id: string | null;
  actor_name: string;
  actor_role: string;
  source: AuditSource;
  schema_name: string;
  table_name: string;
  operation: AuditOperation;
  record_id: string;
  entity_label: string;
  changed_fields: string[];
};
export type AuditDetail = AuditEntry & {
  record_key: Record<string, unknown>;
  before_data: Record<string, unknown> | null;
  after_data: Record<string, unknown> | null;
  context: Record<string, unknown>;
  transaction_id: string;
};
export type AuditPage = { entries: AuditEntry[]; nextCursor: AuditCursor | null };
export type AuditPageResult = { ok: boolean; message: string; page?: AuditPage };
export type AuditDetailResult = { ok: boolean; message: string; detail?: AuditDetail };

export const auditTableLabels: Record<string, string> = {
  events: "Evento", event_rsvps: "Asistencia", stories: "Publicación", site_settings: "Configuración",
  profiles: "Perfil", memberships: "Membresía", access_requests: "Solicitud de acceso", proposals: "Propuesta",
  committees: "Comité", committee_members: "Integrante de comité", activities: "Actividad", tasks: "Tarea",
  internal_messages: "Mensaje", internal_message_recipients: "Entrega de mensaje", notifications: "Aviso",
  media_assets: "Archivo", objects: "Archivo almacenado", users: "Cuenta", sessions: "Sesión", audit_log: "Auditoría",
};
export const auditFieldLabels: Record<string, string> = {
  id: "Identificador", title: "Título", slug: "Enlace", summary: "Resumen", description: "Descripción",
  kind: "Tipo", tone: "Color", starts_at: "Inicio", ends_at: "Fin", venue_name: "Lugar",
  venue_address: "Dirección", location_url: "Enlace de ubicación", capacity: "Capacidad",
  status: "Estado", is_public: "Visible públicamente", cover_image_path: "Imagen de portada",
  created_by: "Creado por", updated_by: "Editado por", created_at: "Fecha de creación", updated_at: "Fecha de edición",
  user_id: "Miembro", event_id: "Evento", rsvp_status: "Respuesta de asistencia", name: "Nombre",
  display_name: "Nombre visible", bio: "Biografía", avatar_path: "Foto de perfil", locale: "Idioma", timezone: "Zona horaria",
  membership_role: "Rol", membership_status: "Estado de membresía", notes: "Notas", approved_by: "Aprobado por",
  approved_at: "Fecha de aprobación", joined_at: "Fecha de ingreso", full_name: "Nombre completo", email: "Correo",
  message: "Mensaje", source: "Origen", request_status: "Estado de solicitud", handled_by: "Atendido por",
  handled_at: "Fecha de atención", content: "Contenido", excerpt: "Extracto", story_type: "Tipo de publicación",
  published_at: "Fecha de publicación", author_id: "Autor", details: "Detalles", review_notes: "Notas de revisión",
  reviewed_by: "Revisado por", reviewed_at: "Fecha de revisión", submitted_at: "Fecha de envío",
  committee_id: "Comité", committee_role: "Responsabilidad", is_active: "Activo", activity_status: "Estado de actividad",
  location: "Ubicación", lead_id: "Responsable", proposal_id: "Propuesta", activity_id: "Actividad",
  task_status: "Estado de tarea", priority: "Prioridad", due_at: "Vencimiento", assignee_id: "Asignado a",
  completed_at: "Fecha de finalización", sender_id: "Remitente", subject: "Asunto", body: "Texto",
  audience_type: "Destinatarios", message_id: "Mensaje", read_at: "Fecha de lectura", href: "Destino",
  site_name: "Nombre de la web", tagline: "Lema", public_email: "Correo público", logo_path: "Logotipo",
  bucket_id: "Carpeta de archivos", path: "Ruta", alt_text: "Texto alternativo", asset_kind: "Tipo de archivo",
  uploaded_by: "Subido por", owner_id: "Propietario", version: "Versión", size: "Tamaño", mimetype: "Formato",
  archived_at: "Fecha de archivo", is_delete_marker: "Archivo retirado", password: "Contraseña",
  email_confirmed_at: "Correo confirmado", banned_until: "Cuenta bloqueada hasta", deleted_at: "Fecha de eliminación",
  is_anonymous: "Cuenta anónima", providers: "Métodos de acceso", not_after: "Caducidad de sesión",
  aal: "Nivel de autenticación", user_agent: "Navegador", ip: "Dirección IP", enabled_at: "Fecha de activación",
};

export function auditActionLabel(entry: Pick<AuditEntry, "table_name" | "operation">) {
  if (entry.table_name === "sessions") return entry.operation === "INSERT" ? "Sesión iniciada" : "Sesión cerrada";
  if (entry.table_name === "event_rsvps") return entry.operation === "DELETE" ? "Asistencia eliminada" : "Asistencia registrada";
  return { INSERT: "Creación", UPDATE: "Edición", DELETE: "Eliminación", ENABLE: "Activación" }[entry.operation];
}

export function auditValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Sí" : "No";
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

const auditDateFormatter = new Intl.DateTimeFormat("es-DO", {
  day: "2-digit", month: "2-digit", year: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  timeZone: "America/Santo_Domingo",
});
export function formatAuditDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  const parts = Object.fromEntries(auditDateFormatter.formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}:${parts.second}`;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function dayStart(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const time = Date.parse(`${value}T00:00:00-04:00`);
  if (!Number.isFinite(time) || new Date(time - 4 * 3600000).toISOString().slice(0, 10) !== value) return null;
  return time;
}

// Display dates as DD/MM/YY; only valid calendar dates reach the ISO server filters.
export function parseAuditDateInput(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const match = /^(\d{2})\/(\d{2})\/(\d{2})$/.exec(trimmed);
  if (!match) return null;
  const iso = `20${match[3]}-${match[2]}-${match[1]}`;
  return dayStart(iso) === null ? null : iso;
}

function quoteFilterValue(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

export function auditCursorFilter(cursor: AuditCursor, sort: AuditSort): string {
  const direction = sort.direction === "asc" ? "gt" : "lt";
  if (sort.column === "occurred_at") {
    return `occurred_at.${direction}.${cursor.time},and(occurred_at.eq.${cursor.time},id.lt.${cursor.id})`;
  }
  const raw = Array.isArray(cursor.value)
    ? `{${cursor.value.map(quoteFilterValue).join(",")}}`
    : String(cursor.value);
  const value = quoteFilterValue(raw);
  return `${sort.column}.${direction}.${value},and(${sort.column}.eq.${value},occurred_at.lt.${cursor.time}),and(${sort.column}.eq.${value},occurred_at.eq.${cursor.time},id.lt.${cursor.id})`;
}

export function auditPageCursor(entry: AuditEntry, sort: AuditSort): AuditCursor {
  const cursor = { time: entry.occurred_at, id: entry.id };
  if (sort.column === "occurred_at" && sort.direction === "desc") return cursor;
  return { ...cursor, ...sort, ...(sort.column === "occurred_at" ? {} : { value: entry[sort.column] }) };
}

// Validate every PostgREST filter and keyset cursor before constructing a query.
export function normalizeAuditQuery(input: AuditFilters, cursor?: AuditCursor | null, sort: AuditSort = defaultAuditSort):
  | { error: string }
  | { filters: AuditFilters; tables: readonly string[]; fromIso: string | null; untilIso: string | null; cursor: AuditCursor | null; sort: AuditSort } {
  if (!input || !Object.hasOwn(auditModules, input.module) ||
    !["all", "INSERT", "UPDATE", "DELETE", "ENABLE"].includes(input.operation) ||
    typeof input.search !== "string" || input.search.trim().length > 120) {
    return { error: "Revisa los filtros del registro de auditoría." };
  }
  if (!sort || !auditSortColumns.includes(sort.column) || !["asc", "desc"].includes(sort.direction)) {
    return { error: "Selecciona una columna y un orden válidos." };
  }
  const from = input.from === "" ? null : dayStart(input.from);
  const until = input.until === "" ? null : dayStart(input.until);
  if ((input.from !== "" && from === null) || (input.until !== "" && until === null) ||
    (from !== null && until !== null && from > until)) {
    return { error: "Indica un intervalo de fechas válido." };
  }
  let normalizedCursor: AuditCursor | null = null;
  if (cursor) {
    if (typeof cursor.id !== "string" || !uuidPattern.test(cursor.id) ||
      typeof cursor.time !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(cursor.time) ||
      !Number.isFinite(Date.parse(cursor.time)) ||
      (cursor.column ?? "occurred_at") !== sort.column || (cursor.direction ?? "desc") !== sort.direction) {
      return { error: "La posición del registro no es válida. Vuelve a consultar." };
    }
    if (sort.column !== "occurred_at") {
      const validValue = sort.column === "changed_fields"
        ? Array.isArray(cursor.value) && cursor.value.length <= 200 && cursor.value.every(field => typeof field === "string" && field.length <= 200)
        : typeof cursor.value === "string" && cursor.value.length <= 10000;
      if (!validValue) return { error: "La posición del registro no es válida. Vuelve a consultar." };
    }
    // Preserve PostgreSQL microseconds: converting through Date would skip rows
    // that share a millisecond at the page boundary.
    normalizedCursor = {
      id: cursor.id, time: cursor.time,
      ...(sort.column === "occurred_at" && sort.direction === "desc" ? {} : { ...sort }),
      ...(sort.column === "occurred_at" ? {} : { value: cursor.value }),
    };
  }
  return {
    filters: { ...input, search: input.search.trim() }, tables: auditModules[input.module].tables,
    fromIso: from === null ? null : new Date(from).toISOString(),
    untilIso: until === null ? null : new Date(until + 86400000).toISOString(), cursor: normalizedCursor, sort,
  };
}
