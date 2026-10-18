export const navigationItems = [
  { id: "resumen", label: "Resumen" },
  { id: "propuestas", label: "Propuestas" },
  { id: "agenda", label: "Agenda" },
  { id: "actividades", label: "Actividades y tareas" },
  { id: "finanzas", label: "Finanzas" },
  { id: "solicitudes", label: "Solicitudes" },
  { id: "organizacion", label: "Miembros y comités" },
  { id: "revista", label: "Revista" },
  { id: "fotografias", label: "Fotos de la web" },
  { id: "auditoria", label: "Auditoría" },
  { id: "diagnostico", label: "Diagnóstico" },
] as const;

export type NavigationItemId = typeof navigationItems[number]["id"];
export type PlatformNavigation = { order: NavigationItemId[]; revision: number; available: boolean };
export const defaultNavigationOrder: NavigationItemId[] = navigationItems.map(item => item.id);

// Workspace pages reachable from the address bar. "mensajes" and "perfil" are opened from the
// header, so they stay outside the shared sidebar order.
export type WorkspaceTabId = NavigationItemId | "mensajes" | "perfil";
export const workspaceTabIds: readonly WorkspaceTabId[] = [...defaultNavigationOrder, "mensajes", "perfil"];

export function allowedWorkspaceTab(id: string | null | undefined, capabilities: { canAudit: boolean; canEdit: boolean }): WorkspaceTabId | null {
  if (!id || !(workspaceTabIds as readonly string[]).includes(id)) return null;
  if ((id === "diagnostico" || id === "auditoria") && !capabilities.canAudit) return null;
  if (id === "fotografias" && !capabilities.canEdit) return null;
  return id as WorkspaceTabId;
}

export function isNavigationOrder(value: unknown): value is NavigationItemId[] {
  return Array.isArray(value) && value.length === defaultNavigationOrder.length
    && new Set(value).size === value.length
    && value.every(id => defaultNavigationOrder.includes(id));
}

// Keep hidden pages in the saved order; role filtering is only a presentation step.
export function moveNavigationItem(order: NavigationItemId[], source: NavigationItemId, target: NavigationItemId) {
  const next = [...order];
  const from = next.indexOf(source);
  const to = next.indexOf(target);
  if (from < 0 || to < 0 || from === to) return next;
  next.splice(from, 1);
  next.splice(to, 0, source);
  return next;
}
