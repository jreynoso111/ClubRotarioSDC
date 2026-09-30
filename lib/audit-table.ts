import type { AuditSortColumn } from "./audit";

export const auditColumns = [
  { id: "occurred_at", label: "Fecha y hora", width: 154 },
  { id: "actor_name", label: "Persona", width: 150 },
  { id: "operation", label: "Acción", width: 158 },
  { id: "table_name", label: "Módulo", width: 110 },
  { id: "entity_label", label: "Registro", width: 240 },
  { id: "changed_fields", label: "Cambios", width: 190 },
  { id: "actor_role", label: "Rol", width: 140 },
  { id: "source", label: "Origen", width: 130 },
] as const satisfies readonly { id: AuditSortColumn; label: string; width: number }[];

export type AuditTableLayout = { order: AuditSortColumn[]; hidden: AuditSortColumn[] };
export const defaultAuditLayout: AuditTableLayout = {
  order: auditColumns.map(column => column.id), hidden: ["actor_role", "source"],
};

// Ignore obsolete or malformed saved preferences without hiding every column.
export function readAuditLayout(saved: string | null): AuditTableLayout {
  if (!saved) return defaultAuditLayout;
  try {
    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed.order) || !Array.isArray(parsed.hidden)) return defaultAuditLayout;
    const valid = (id: unknown): id is AuditSortColumn => auditColumns.some(column => column.id === id);
    const order: AuditSortColumn[] = [...new Set<AuditSortColumn>(parsed.order.filter(valid))];
    for (const column of auditColumns) if (!order.includes(column.id)) order.push(column.id);
    const hidden: AuditSortColumn[] = [...new Set<AuditSortColumn>(parsed.hidden.filter(valid))];
    return { order, hidden: hidden.length === order.length ? defaultAuditLayout.hidden : hidden };
  } catch {
    return defaultAuditLayout;
  }
}

export function moveAuditColumn(layout: AuditTableLayout, id: AuditSortColumn, step: -1 | 1): AuditTableLayout {
  const index = layout.order.indexOf(id);
  const target = index + step;
  if (index < 0 || target < 0 || target >= layout.order.length) return layout;
  const order = [...layout.order];
  [order[index], order[target]] = [order[target], order[index]];
  return { ...layout, order };
}
