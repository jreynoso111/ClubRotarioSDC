import { redirect } from "next/navigation";

import { MfaForm } from "@/app/auth/MfaForm";
import { safeAuthNext } from "@/lib/auth-navigation";
import { createClient } from "@/utils/supabase/server";

export const dynamic = "force-dynamic";

export default async function MfaPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const nextPath = safeAuthNext((await searchParams).next);
  const { data, error } = await (await createClient()).auth.getUser();
  if (error || !data.user) redirect(`/auth/sign-in?next=${encodeURIComponent("/auth/mfa")}`);
  return <MfaForm nextPath={nextPath} />;
}
