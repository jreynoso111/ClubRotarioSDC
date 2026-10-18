import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function loadTypeScript(relativePath, dependencies = {}) {
  const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function("require", "exports", output)((name) => {
    assert.ok(dependencies[name], `Unexpected dependency ${name} from ${relativePath}`);
    return dependencies[name];
  }, exports);
  return exports;
}

const email = loadTypeScript("../lib/email.ts", { "server-only": {} });

test("club emails escape names and links in HTML while the plain text keeps them readable", () => {
  const received = email.applicationReceivedEmail(`<img src=x onerror="alert(1)"> Ana & Luis`);
  assert.doesNotMatch(received.html, /<img/);
  assert.match(received.html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt; Ana &amp; Luis/);
  assert.match(received.text, /<img src=x onerror="alert\(1\)"> Ana & Luis/);

  const invitation = email.applicationInvitationEmail(`Ana "Pérez"`, `https://www.clubrotariosdcolonial.org/auth/sign-up?next="x"`);
  assert.doesNotMatch(invitation.html, /Ana "Pérez"/);
  assert.match(invitation.html, /Ana &quot;Pérez&quot;/);
  assert.match(invitation.html, /href="https:\/\/www\.clubrotariosdcolonial\.org\/auth\/sign-up\?next=&quot;x&quot;"/);
  assert.match(invitation.text, /https:\/\/www\.clubrotariosdcolonial\.org\/auth\/sign-up\?next="x"/);
  assert.match(invitation.text, /este mismo correo electrónico/);
  assert.match(invitation.text, /aprobará tu membresía/);
});

test("sendClubEmail posts through Resend and reports missing keys and failures as false", async () => {
  const originalKey = process.env.RESEND_API_KEY;
  const originalFrom = process.env.CLUB_EMAIL_FROM;
  const originalFetch = globalThis.fetch;
  const message = { to: "maria@example.org", ...email.applicationReceivedEmail("María") };
  try {
    delete process.env.RESEND_API_KEY;
    globalThis.fetch = async () => { throw new Error("The network must not be called without a key."); };
    assert.equal(await email.sendClubEmail(message), false);

    process.env.RESEND_API_KEY = " test-resend-key ";
    delete process.env.CLUB_EMAIL_FROM;
    const sent = [];
    globalThis.fetch = async (url, init) => { sent.push({ url, init }); return new Response("{}", { status: 200 }); };
    assert.equal(await email.sendClubEmail(message), true);
    assert.equal(sent[0].url, "https://api.resend.com/emails");
    assert.equal(sent[0].init.method, "POST");
    assert.equal(sent[0].init.headers.Authorization, "Bearer test-resend-key");
    const body = JSON.parse(sent[0].init.body);
    assert.equal(body.from, "Club Rotario Santo Domingo Colonial <no-reply@auth.clubrotariosdcolonial.org>");
    assert.deepEqual(body.to, ["maria@example.org"]);
    assert.equal(body.subject, message.subject);
    assert.equal(body.text, message.text);
    assert.equal(body.html, message.html);

    process.env.CLUB_EMAIL_FROM = "Club Rotario <club@example.org>";
    await email.sendClubEmail(message);
    assert.equal(JSON.parse(sent[1].init.body).from, "Club Rotario <club@example.org>");

    globalThis.fetch = async () => new Response("{}", { status: 422 });
    assert.equal(await email.sendClubEmail(message), false);

    globalThis.fetch = async () => { throw new TypeError("network down"); };
    assert.equal(await email.sendClubEmail(message), false);
  } finally {
    if (originalKey === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = originalKey;
    if (originalFrom === undefined) delete process.env.CLUB_EMAIL_FROM; else process.env.CLUB_EMAIL_FROM = originalFrom;
    globalThis.fetch = originalFetch;
  }
});
