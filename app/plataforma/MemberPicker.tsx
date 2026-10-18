"use client";

import { useId, useState } from "react";

import { filterMemberOptions, type PickableMember } from "@/lib/member-picker";

import styles from "./member-picker.module.css";

// A text filter over a native listbox: the value stays a plain select value, so
// keyboard and screen-reader behaviour is the same as a select.
export function MemberPicker({
  label,
  candidates,
  value,
  onChange,
  emptyLabel,
  optional = false,
  disabledIds,
  hint,
}: {
  label: string;
  candidates: readonly PickableMember[];
  value: string;
  onChange: (userId: string) => void;
  emptyLabel: string;
  optional?: boolean;
  disabledIds?: ReadonlySet<string>;
  hint?: string;
}) {
  const [query, setQuery] = useState("");
  const labelId = useId();
  const hintId = useId();
  const matches = filterMemberOptions(candidates, query).length;
  const options = filterMemberOptions(candidates, query, value || null);
  const rows = Math.min(7, Math.max(3, options.length + 1));

  return (
    <div className={styles.picker}>
      <span id={labelId} className={styles.label}>{label}</span>
      <input
        type="search"
        aria-label={`Buscar: ${label}`}
        value={query}
        placeholder="Escribe un nombre"
        autoComplete="off"
        onChange={(event) => setQuery(event.currentTarget.value)}
      />
      <select
        aria-labelledby={labelId}
        aria-describedby={hint ? hintId : undefined}
        size={rows}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      >
        <option value="" disabled={!optional}>{emptyLabel}</option>
        {options.map((candidate) => (
          <option key={candidate.userId} value={candidate.userId} disabled={disabledIds?.has(candidate.userId)}>
            {candidate.name}
          </option>
        ))}
      </select>
      <small className={styles.count}>
        {query.trim()
          ? matches === 0
            ? `Ninguna persona coincide con «${query.trim()}».`
            : `${matches} ${matches === 1 ? "coincidencia" : "coincidencias"}`
          : `${candidates.length} ${candidates.length === 1 ? "persona" : "personas"} disponibles`}
      </small>
      {hint ? <small id={hintId} className={styles.hint}>{hint}</small> : null}
    </div>
  );
}
