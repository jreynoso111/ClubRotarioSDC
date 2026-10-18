import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

import { accountDependencies } from "./helpers/account-deps.mjs";

function compile(file, dependencies = {}) {
  const exports = {};
  const source = ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function("require", "exports", source)(name => {
    assert.ok(name in dependencies, `Unexpected dependency ${name}`);
    return dependencies[name];
  }, exports);
  return exports;
}

const viewerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const memberId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const uuid = "22222222-2222-4222-8222-222222222222";
const memberPath = `${memberId}/avatar-${uuid}.webp`;

// The fake client models RLS: profiles are visible only when the viewer is the owner or an active member.
function setup({ viewer = viewerId, viewerStatus = "active", profiles = { [memberId]: { avatar_path: memberPath } }, downloadError = null } = {}) {
  const calls = { downloads: [], profileReads: [] };
  const client = {
    auth: {
      getUser: async () => viewer
        ? { data: { user: { id: viewer } }, error: null }
        : { data: { user: null }, error: new Error("missing session") },
    },
    from(table) {
      let filter = null;
      const builder = {
        select() { return builder; },
        eq(column, value) { filter = { column, value }; return builder; },
        async maybeSingle() {
          if (table === "memberships") {
            return { data: filter.value === viewer && viewerStatus ? { membership_status: viewerStatus } : null, error: null };
          }
          if (table === "profiles") {
            calls.profileReads.push(filter.value);
            const visible = filter.value === viewer || viewerStatus === "active";
            const row = visible ? profiles[filter.value] : undefined;
            return { data: row ? { ...row } : null, error: null };
          }
          return { data: null, error: null };
        },
      };
      return builder;
    },
  };
  const admin = {
    storage: {
      from(bucket) {
        assert.equal(bucket, "club-media");
        return {
          download: async path => {
            calls.downloads.push(path);
            return downloadError ? { data: null, error: downloadError } : { data: new Blob([new Uint8Array([82, 73, 70, 70])], { type: "image/webp" }), error: null };
          },
        };
      },
    },
  };
  const route = compile("../app/plataforma/avatar/[id]/route.ts", {
    "@/lib/account": accountDependencies["@/lib/account"],
    "@/utils/supabase/admin": { createAdminClient: () => admin },
    "@/utils/supabase/config": { isSupabaseConfigured: () => true },
    "@/utils/supabase/server": { createClient: async () => client },
  });
  return { GET: route.GET, dynamic: route.dynamic, calls };
}

const request = id => ({ request: new Request(`https://www.clubrotariosdcolonial.org/plataforma/avatar/${id}`), context: { params: Promise.resolve({ id }) } });

test("the avatar route answers 404 for signed-out users, non-members, invalid ids and profiles without a photo", async () => {
  assert.equal(setup().dynamic, "force-dynamic");

  const signedOut = setup({ viewer: null });
  assert.equal((await signedOut.GET(request(memberId).request, request(memberId).context)).status, 404);
  assert.equal(signedOut.calls.downloads.length, 0);

  const pending = setup({ viewerStatus: "pending" });
  const denied = await pending.GET(request(memberId).request, request(memberId).context);
  assert.equal(denied.status, 404);
  assert.equal(pending.calls.downloads.length, 0, "a pending or suspended viewer never reaches Storage");

  const suspended = setup({ viewerStatus: "suspended" });
  assert.equal((await suspended.GET(request(memberId).request, request(memberId).context)).status, 404);

  const invalid = setup();
  assert.equal((await invalid.GET(request("not-a-uuid").request, request("not-a-uuid").context)).status, 404);
  assert.equal(invalid.calls.profileReads.length, 0);

  const withoutPhoto = setup({ profiles: { [memberId]: { avatar_path: null } } });
  assert.equal((await withoutPhoto.GET(request(memberId).request, request(memberId).context)).status, 404);
  assert.equal(withoutPhoto.calls.downloads.length, 0);

  const foreignPath = setup({ profiles: { [memberId]: { avatar_path: `${viewerId}/avatar-${uuid}.webp` } } });
  assert.equal((await foreignPath.GET(request(memberId).request, request(memberId).context)).status, 404);
  assert.equal(foreignPath.calls.downloads.length, 0, "a path outside the profile owner's folder is never read");

  const missingObject = setup({ downloadError: { message: "Object not found" } });
  assert.equal((await missingObject.GET(request(memberId).request, request(memberId).context)).status, 404);
});

test("active members receive the photo as a private, cacheable WebP", async () => {
  const fixture = setup();
  const response = await fixture.GET(request(memberId).request, request(memberId).context);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "image/webp");
  assert.equal(response.headers.get("Cache-Control"), "private, max-age=300");
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [82, 73, 70, 70]);
  assert.deepEqual(fixture.calls.downloads, [memberPath]);
});

test("members can always read their own photo, even when the membership row is not active", async () => {
  const fixture = setup({ viewer: memberId, viewerStatus: "pending" });
  const response = await fixture.GET(request(memberId).request, request(memberId).context);
  assert.equal(response.status, 200);
  assert.deepEqual(fixture.calls.downloads, [memberPath]);
});
