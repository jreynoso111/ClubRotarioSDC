import { SignInForm } from "@/app/auth/SignInForm";
import { safeAuthNext } from "@/lib/auth-navigation";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const params = await searchParams;
  return <SignInForm nextPath={safeAuthNext(params.next)} confirmationError={params.error === "confirmation"} />;
}
