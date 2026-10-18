import type { PlatformRole } from "@/lib/platform";

// Shared by the members screen and the server actions. The database remains the authority;
// these rules only shape the form so that it asks for what the server will require.
export type MemberStatus = "pending" | "active" | "suspended";

type AccessState = { role: PlatformRole; status: MemberStatus };

export const platformRoles: PlatformRole[] = ["member", "coordinator", "editor", "club_manager", "admin"];
export const memberStatuses: MemberStatus[] = ["active", "pending", "suspended"];

export const platformRoleLabels: Record<PlatformRole, string> = {
  member: "Miembro",
  coordinator: "Coordinación",
  editor: "Edición de la web",
  club_manager: "Gestión del club",
  admin: "Administración",
};

export const memberStatusLabels: Record<MemberStatus, string> = { active: "Activo", pending: "Pendiente", suspended: "Suspendido" };

export const memberReasonRange = { min: 5, max: 500 } as const;
export const memberNotesMaxLength = 4000;

export function partitionClubAccounts<T extends { role: PlatformRole }>(accounts: T[]) {
  return {
    members: accounts.filter(account => account.role !== "admin"),
    administrativeAccounts: accounts.filter(account => account.role === "admin"),
  };
}

const roleRank: Record<PlatformRole, number> = { member: 0, coordinator: 1, editor: 1, club_manager: 2, admin: 3 };

// Club managers cannot change administrator or club manager accounts; administrators can change any account.
export function actorCanModifyAccount(actorRole: PlatformRole, targetRole: PlatformRole) {
  return actorRole === "admin" || (targetRole !== "admin" && targetRole !== "club_manager");
}

// Club managers can only grant ordinary roles; administrators can grant every role.
export function assignableRoles(actorRole: PlatformRole): PlatformRole[] {
  return actorRole === "admin" ? platformRoles : platformRoles.filter(role => role === "member" || role === "coordinator" || role === "editor");
}

// The database requires a reason to suspend a member or to change a role.
export function accessChangeNeedsReason(current: AccessState, next: AccessState) {
  return next.role !== current.role || (next.status === "suspended" && current.status !== "suspended");
}

// Suspending a member or lowering a role changes what they can do, so the manager confirms first.
export function accessChangeNeedsConfirmation(current: AccessState, next: AccessState) {
  return (next.status === "suspended" && current.status !== "suspended") || roleRank[next.role] < roleRank[current.role];
}

// Case and accent insensitive, so "coordinacion" finds "Coordinación".
export function normalizeSearchText(text: string) {
  return text.toLocaleLowerCase("es").normalize("NFD").replace(/[̀-ͯ]/g, "");
}
