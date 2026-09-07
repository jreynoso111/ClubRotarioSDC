import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { PasswordForm } from "../PasswordForm";

export const metadata = { title: "Nueva contraseña" };
export default async function ResetPasswordPage() {
  const client = await createClient();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) redirect("/auth/forgot-password");
  return <PasswordForm reset />;
}
