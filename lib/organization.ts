export type LeadershipTerm = {
  id: string;
  startYear: number;
  label: string;
  locked: boolean;
  updatedAt: string;
};

export type LeadershipPosition = {
  id: string;
  termId: string;
  title: string;
  responsibilities: string;
  parentId: string | null;
  memberId: string | null;
  memberName: string | null;
  sortOrder: number;
  active: boolean;
  accessRole: PlatformRole;
  updatedAt: string;
};

export type OrganizationMember = { userId: string; name: string; bio: string | null; accessRole?: PlatformRole };
export type LeadershipNode = LeadershipPosition & { children: LeadershipNode[] };
export type OrganizationData = { terms: LeadershipTerm[]; positions: LeadershipPosition[]; members: OrganizationMember[]; termId: string | null };

export function currentRotaryYear(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en", { year: "numeric", month: "numeric", timeZone: "America/Santo_Domingo" }).formatToParts(date);
  const year = Number(parts.find(part => part.type === "year")?.value);
  const month = Number(parts.find(part => part.type === "month")?.value);
  return month >= 7 ? year : year - 1;
}

export function leadershipYearLabel(year: number) { return `${year}–${year + 1}`; }

export function buildLeadershipTree(positions: LeadershipPosition[]): LeadershipNode[] {
  const active = positions.filter(position => position.active).sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title, "es"));
  const nodes = new Map(active.map(position => [position.id, { ...position, children: [] as LeadershipNode[] }]));
  const roots: LeadershipNode[] = [];
  for (const position of active) {
    const node = nodes.get(position.id)!;
    const visited = new Set([position.id]);
    let ancestor = position.parentId;
    let cyclic = false;
    while (ancestor && nodes.has(ancestor)) {
      if (visited.has(ancestor)) { cyclic = true; break; }
      visited.add(ancestor);
      ancestor = nodes.get(ancestor)!.parentId;
    }
    const parent = position.parentId ? nodes.get(position.parentId) : undefined;
    if (parent && !cyclic) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

export function leadershipDescendants(positions: LeadershipPosition[], positionId: string) {
  const ids = new Set([positionId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const position of positions) {
      if (position.parentId && ids.has(position.parentId) && !ids.has(position.id)) { ids.add(position.id); changed = true; }
    }
  }
  return ids;
}
import type { PlatformRole } from "./platform";

export const organizationAccessLevels: Array<{ id: PlatformRole; label: string; description: string }> = [
  { id: "member", label: "Miembro", description: "Consulta el club y sus aportes, participa en propuestas y confirma su asistencia a eventos." },
  { id: "coordinator", label: "Coordinación", description: "Organiza actividades, tareas y eventos, revisa propuestas y envía avisos al club." },
  { id: "editor", label: "Edición", description: "Gestiona publicaciones, fotografías y contenido de la web." },
  { id: "club_manager", label: "Gestión del club", description: "Gestiona miembros, finanzas y publicaciones, y coordina actividades, eventos y avisos del club." },
  { id: "admin", label: "Administración", description: "Acceso completo. Administra los módulos del club y la web, define cargos, asigna permisos y consulta la auditoría." },
];
