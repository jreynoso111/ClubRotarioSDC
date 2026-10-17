#!/usr/bin/env bash
# Offline database check: applies every migration to a throwaway Postgres with a
# minimal Supabase stub, then runs supabase/tests/*.sql. Never point it at the
# club's real backend: it drops and recreates the database named in PGDATABASE.
# Usage: PGHOST=localhost PGPORT=5432 PGUSER=postgres PGDATABASE=club_ci bash scripts/run-db-tests.sh
set -uo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
db="${PGDATABASE:-club_ci}"
case "$db" in postgres|template0|template1) echo "Refusing to use $db"; exit 2;; esac
psql_admin=(psql -X -q -v ON_ERROR_STOP=1 -d postgres)
"${psql_admin[@]}" -c "drop database if exists \"$db\"" -c "create database \"$db\"" >/dev/null || exit 1
run=(psql -X -q -v ON_ERROR_STOP=1 -d "$db")
"${run[@]}" -f "$root/supabase/tests/support/supabase_stub.sql" >/dev/null || exit 1
for migration in "$root"/supabase/migrations/*.sql; do
  "${run[@]}" -f "$migration" >/dev/null || { echo "Migration failed: $(basename "$migration")"; exit 1; }
done
"${run[@]}" -f "$root/supabase/tests/support/pgtap_shim.sql" >/dev/null || exit 1
total=0; failed=0
for suite in "$root"/supabase/tests/*.sql; do
  output=$(psql -X -t -A -d "$db" -f "$suite" 2>&1)
  count=$(grep -cE '^(not )?ok ' <<<"$output")
  bad=$(grep -cE '^not ok |ERROR' <<<"$output")
  total=$((total + count)); failed=$((failed + bad))
  echo "$(basename "$suite"): $count assertions, $bad failures"
  grep -E '^not ok |ERROR' <<<"$output" | head -5
done
echo "Total: $total assertions, $failed failures"
[ "$failed" -eq 0 ]
