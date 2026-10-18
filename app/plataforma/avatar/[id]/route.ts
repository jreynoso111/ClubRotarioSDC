import { avatarBucket, isLowercaseUuid, isOwnAvatarPath } from "@/lib/account";
import { createAdminClient } from "@/utils/supabase/admin";
import { isSupabaseConfigured } from "@/utils/supabase/config";
import { createClient } from "@/utils/supabase/server";

export const dynamic = "force-dynamic";

const notFound = () => new Response(null, { status: 404, headers: { "Cache-Control": "private, no-store" } });

// Serves a profile photo to its owner and to active members. Everything else answers 404,
// so the route does not reveal whether a profile exists or has a photo.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isSupabaseConfigured() || !isLowercaseUuid(id)) return notFound();
  try {
    const supabase = await createClient();
    const { data: userData, error: userError } = await supabase.auth.getUser();
    const viewer = userData?.user?.id;
    if (userError || !viewer) return notFound();

    if (viewer !== id) {
      const { data: membership, error: membershipError } = await supabase.from("memberships")
        .select("membership_status").eq("user_id", viewer).maybeSingle();
      if (membershipError || membership?.membership_status !== "active") return notFound();
    }

    // RLS decides which profiles the viewer may read: their own, or those of active members.
    const { data: profile, error: profileError } = await supabase.from("profiles")
      .select("avatar_path").eq("id", id).maybeSingle();
    const path = profile?.avatar_path;
    if (profileError || !isOwnAvatarPath(id, path)) return notFound();

    // Members cannot read other folders through Storage policies, so the server reads the object.
    const { data: blob, error: downloadError } = await createAdminClient().storage.from(avatarBucket).download(path);
    if (downloadError || !blob) return notFound();
    return new Response(blob, {
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return notFound();
  }
}
