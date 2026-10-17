import assert from "node:assert/strict";
import { test } from "node:test";
import { toPublicSupabaseUrl } from "./helpers/supabase-public-url.mjs";

test("server storage URLs become public without rewriting unrelated or lookalike hosts", () => {
  const previous = { internal: process.env.SUPABASE_SERVER_URL, public: process.env.NEXT_PUBLIC_SUPABASE_URL };
  try {
    process.env.SUPABASE_SERVER_URL = "http://127.0.0.1:26911/";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://api.clubrotariosdcolonial.org/";
    assert.equal(toPublicSupabaseUrl("http://127.0.0.1:26911/storage/v1/object/public/club-public/a.webp"), "https://api.clubrotariosdcolonial.org/storage/v1/object/public/club-public/a.webp");
    for (const value of ["https://other.invalid/a.webp", "http://127.0.0.1:26911.evil.invalid/a.webp", "/illustration.svg"]) {
      assert.equal(toPublicSupabaseUrl(value), value);
    }
  } finally {
    for (const [key, value] of [["SUPABASE_SERVER_URL", previous.internal], ["NEXT_PUBLIC_SUPABASE_URL", previous.public]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
