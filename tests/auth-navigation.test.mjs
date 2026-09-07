import assert from "node:assert/strict";
import { test } from "node:test";
import { safeAuthNext } from "../lib/auth-navigation.ts";

test("only permitted authentication destinations survive", () => {
  for (const path of ["/plataforma", "/plataforma?tab=eventos", "/plataforma/perfil", "/auth/reset-password"]) {
    assert.equal(safeAuthNext(path), path);
  }
});

test("rejects open redirects and paths outside the platform", () => {
  for (const path of [null, undefined, "https://example.com", "//example.com", "/\\example.com", "/plataforma\\@example.com", "/plataforma\n", "/plataformafalsa", "/auth/callback", "/"]) {
    assert.equal(safeAuthNext(path), "/plataforma");
  }
});
