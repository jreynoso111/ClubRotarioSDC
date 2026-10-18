import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { FirstPasswordForm } from "./FirstPasswordForm";

export default async function FirstPasswordPage() {
  const client = await createClient();
  const user = await client.auth.getUser();
  if (user.error || !user.data.user) redirect("/auth/sign-in");
  const state = await client.rpc("account_password_state");
  if (!state.error && state.data === "ready") redirect("/plataforma");
  if (!state.error && state.data === "sign_in_again") redirect("/auth/sign-in?notice=password-updated");
  return <FirstPasswordForm />;
}
