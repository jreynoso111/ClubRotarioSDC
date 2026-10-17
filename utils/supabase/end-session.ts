import "server-only";
import { cookies } from "next/headers";
import { createClient } from "./server";
import { getSupabaseConfig } from "./config";
import { recordDiagnostic } from "@/lib/diagnostics-store";

export async function endServerSession(all = false) {
  const jar = await cookies();
  const { cookieName } = getSupabaseConfig();
  try {
    const { error } = await (await createClient()).auth.signOut({ scope: all ? "global" : "local" });
    if (error) await recordDiagnostic({ scope: "server", code: "backend_error", path: "/auth/reset-password", status: error.status });
  } catch { await recordDiagnostic({ scope: "server", code: "network_error", path: "/auth/reset-password" }); }
  for (const cookie of jar.getAll()) {
    if (cookie.name === cookieName || cookie.name.startsWith(`${cookieName}.`) || cookie.name === `${cookieName}-code-verifier`) {
      jar.set(cookie.name, "", { path: "/", maxAge: 0, sameSite: "lax" });
    }
  }
}
