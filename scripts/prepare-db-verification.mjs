import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Produce one SQL Editor query. Each suite runs in a subtransaction which is
// deliberately rolled back, including pgTAP, fixtures, and their audit records.
const root = fileURLToPath(new URL("../", import.meta.url));
const output = resolve(process.argv[2] ?? join(tmpdir(), "clubrotario-db-verification.sql"));
const requested = process.argv.slice(3);
const suites = requested.length ? requested : [
  "admin_committee_management_test.sql",
  "admin_committee_flow_test.sql",
  "proposal_voting_rls_test.sql",
  "club_finance_management_rls_test.sql",
  "club_membership_applications_rls_test.sql",
  "membership_photo_gallery_rls_test.sql",
];

const blocks = suites.map((file) => {
  if (basename(file) !== file || !/^[a-z_]+\.sql$/.test(file)) {
    throw new Error(`Invalid suite filename: ${file}`);
  }
  const source = readFileSync(join(root, "supabase/tests", file), "utf8");
  const expected = source.match(/select\s+plan\((\d+)\)/i)?.[1] ?? "null";
  const body = source
    .replace(/^\s*(begin|rollback)\s*;\s*$/gim, "")
    .replace(/^(\s*)select\s+(plan|ok|is|isnt|lives_ok|throws_ok|results_eq|set_eq)\s*\(/gim,
      "$1insert into club_verification_tap (result) select $2(")
    .replace(/^\s*select\s+\*\s+from\s+finish\(\)\s*;/gim,
      "insert into club_verification_tap (result) select * from finish();");
  if (body.includes("$club_suite_sql$") || body.includes("$club_verification$")) {
    throw new Error(`Reserved dollar-quote delimiter in ${file}`);
  }
  const hash = createHash("sha256").update(source).digest("hex");
  return `
  begin
    execute $club_suite_sql$
      create extension if not exists pgtap with schema extensions;
      set local search_path = public, extensions;
      create temporary table club_verification_tap (result text not null);
      grant select, insert on club_verification_tap to anon, authenticated;
      ${body}
      reset role;
    $club_suite_sql$;
    select jsonb_build_object(
      'suite', '${file}', 'sha256', '${hash}', 'expected', ${expected},
      'assertions', count(*) filter (where result ~ '^(not )?ok [0-9]+'),
      'passed', count(*) filter (where result ~ '^ok [0-9]+'),
      'failures', coalesce(jsonb_agg(result) filter (where result ~ '^not ok'), '[]'::jsonb),
      'diagnostics', coalesce(jsonb_agg(result) filter (where result ~ '^#'), '[]'::jsonb),
      'data_reverted', true
    ) into suite_report from club_verification_tap;
    raise exception using errcode = 'ZB001', message = 'Revert verification fixtures';
  exception
    when sqlstate 'ZB001' then null;
    when others then
      suite_report := jsonb_build_object('suite', '${file}', 'sha256', '${hash}',
        'error', sqlerrm, 'sqlstate', sqlstate, 'data_reverted', true);
  end;
  report := report || jsonb_build_array(suite_report);
`;
});

const query = `-- ClubRotario: integration verification, with no committed fixtures or extension changes.
do $club_verification$
declare
  report jsonb := '[]'::jsonb;
  suite_report jsonb;
begin
${blocks.join("\n")}
  perform set_config('clubrotario.verification', report::text, true);
end $club_verification$;
select current_setting('clubrotario.verification')::jsonb as verification;
`;
writeFileSync(output, query);
console.log(`Prepared ${suites.length} suites: ${output}`);
