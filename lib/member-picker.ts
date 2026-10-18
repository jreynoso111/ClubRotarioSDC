// Pure rules shared by the searchable member picker and committee role assignment.

export type PickableMember = { userId: string; name: string };
export type RoleHolder = { userId: string; role: string };

export function normalizeMemberSearch(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("es").trim();
}

// Filters by name, ignoring accents and case. The selected person stays listed
// so that a native select never displays an option that does not exist.
export function filterMemberOptions<T extends PickableMember>(candidates: readonly T[], query: string, selectedId?: string | null): T[] {
  const needle = normalizeMemberSearch(query);
  const matches = candidates
    .filter((candidate) => normalizeMemberSearch(candidate.name).includes(needle))
    .sort((left, right) => left.name.localeCompare(right.name, "es"));
  const selected = selectedId ? candidates.find((candidate) => candidate.userId === selectedId) : undefined;
  return selected && !matches.includes(selected) ? [selected, ...matches] : matches;
}

// A committee has one chair. Returns the person who already holds the chair when
// a different person (or none) is chosen; null when the chair is free for that person.
export function chairConflict<T extends RoleHolder>(members: readonly T[], userId: string | null | undefined): T | null {
  const holder = members.find((member) => member.role === "chair");
  return holder && holder.userId !== userId ? holder : null;
}
