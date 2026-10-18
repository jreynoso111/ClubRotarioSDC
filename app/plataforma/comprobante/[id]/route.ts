import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RECEIPT_BUCKET = "club-finance-receipts";
const contentTypes: Record<string, string> = { pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
const deny = (status: number) => new Response(null, { status, headers: { "Cache-Control": "private, no-store" } });

// The public edge only exposes the public bucket, so receipts are streamed
// through the platform. Both reads use the visitor's own session: row-level
// security and the storage policies limit them to management and the member.
export async function GET(_request: Request, ctx: RouteContext<"/plataforma/comprobante/[id]">) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return deny(404);
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return deny(401);
  const { data: entry } = await supabase.from("finance_entries").select("attachment_path").eq("id", id).maybeSingle();
  const path = entry?.attachment_path;
  if (!path || !path.startsWith(`${id}/`)) return deny(404);
  const type = contentTypes[path.split(".").pop()?.toLowerCase() ?? ""];
  if (!type) return deny(404);
  const { data: file, error } = await supabase.storage.from(RECEIPT_BUCKET).download(path);
  if (error || !file) return deny(404);
  return new Response(file.stream(), {
    headers: {
      "Content-Type": type,
      "Content-Disposition": `inline; filename="comprobante-${id.slice(0, 8)}.${path.split(".").pop()}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
