import assert from "node:assert/strict";
import { test } from "node:test";
import { createBrowserClient, createServerClient } from "@supabase/ssr";
import { getAuthCookieName } from "../utils/supabase/session-options.ts";
import { confirmEmail } from "../lib/auth-confirmation.ts";
import { readEmailSession } from "../lib/email-session.ts";

test("a browser session remains readable over the private server transport", async () => {
  const publicUrl = "https://api.clubrotariosdcolonial.org";
  const user = { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated" };
  const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
  const accessToken = `${encode({ alg: "HS256" })}.${encode({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600 })}.${Buffer.from("test signature").toString("base64url")}`;
  const jar = new Map();
  const cookieName = getAuthCookieName(publicUrl);
  const cookies = {
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    setAll: values => values.forEach(({ name, value }) => jar.set(name, value)),
  };
  let authorizedRequests = 0;
  const fetchUser = async (_url, options) => {
    if (new Headers(options?.headers).get("Authorization") === `Bearer ${accessToken}`) authorizedRequests++;
    return new Response(JSON.stringify(user), { headers: { "Content-Type": "application/json" } });
  };
  const browser = createBrowserClient(publicUrl, "test-public-key", {
    isSingleton: false, cookies, cookieOptions: { name: cookieName }, global: { fetch: fetchUser },
    auth: { autoRefreshToken: false },
  });
  const session = await browser.auth.setSession({ access_token: accessToken, refresh_token: "test-refresh-token" });
  assert.equal(session.error, null);
  assert.ok([...jar.keys()].some(name => name.startsWith(cookieName)));

  const internal = createServerClient("http://127.0.0.1:26911", "test-public-key", {
    cookies, cookieOptions: { name: cookieName }, global: { fetch: fetchUser },
  });
  const result = await internal.auth.getUser();
  assert.equal(result.error, null);
  assert.equal(result.data.user.id, user.id);
  assert.equal(authorizedRequests, 2);

  // Regression: deriving the key from 127.0.0.1 loses the browser's cookie.
  const incompatible = createServerClient("http://127.0.0.1:26911", "test-public-key", { cookies });
  assert.ok((await incompatible.auth.getUser()).error);
});

test("email confirmation consumes the one-time hash without requiring a PKCE browser cookie", async () => {
  for (const [type, expected] of [["recovery", "/auth/reset-password"], ["email", "/auth/sign-in?notice=confirmed"]]) {
    const calls = [];
    const client = { auth: { verifyOtp: async value => { calls.push(value); return { error: null }; } } };
    const result = await confirmEmail(new URLSearchParams({ type, token_hash: "one-time-test-hash", next: "https://untrusted.invalid" }), client);
    assert.equal(result, expected);
    assert.deepEqual(calls, [{ token_hash: "one-time-test-hash", type }]);
  }
});

test("invalid, expired and rejected email links never create a successful redirect", async () => {
  const failed = "/auth/sign-in?error=confirmation";
  for (const query of ["", "type=recovery", "token_hash=test&type=invite", "token_hash=test&type=email_change"]) {
    const client = { auth: { verifyOtp: async () => { assert.fail("invalid input must not reach Auth"); } } };
    assert.equal(await confirmEmail(new URLSearchParams(query), client), failed);
  }
  for (const verifyOtp of [async () => ({ error: new Error("expired") }), async () => { throw new Error("offline"); }]) {
    assert.equal(await confirmEmail(new URLSearchParams("type=recovery&token_hash=secret"), { auth: { verifyOtp } }), failed);
  }
});

test("email fragments have fixed destinations and reject incomplete or failed verification", () => {
  assert.deepEqual(readEmailSession("#access_token=test-access&refresh_token=test-refresh&type=recovery&next=https://evil.invalid"), {
    accessToken: "test-access", refreshToken: "test-refresh", destination: "/auth/reset-password",
  });
  assert.equal(readEmailSession("#access_token=a&refresh_token=r&type=signup").destination, "/auth/sign-in?notice=confirmed");
  for (const fragment of ["", "#error=access_denied", "#access_token=a&type=recovery", "#access_token=a&refresh_token=r&type=unexpected", "#access_token=a&refresh_token=r&type=recovery&error=expired"]) {
    assert.equal(readEmailSession(fragment), null);
  }
});
