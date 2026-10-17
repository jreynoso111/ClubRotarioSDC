type ConfirmationClient = {
  auth: {
    verifyOtp: (params: { token_hash: string; type: "email" | "recovery" }) => Promise<{ error: unknown }>;
  };
};

export async function confirmEmail(params: URLSearchParams, client: ConfirmationClient) {
  const tokenHash = params.get("token_hash");
  const type = params.get("type");
  if (tokenHash && tokenHash.length <= 1024 && (type === "email" || type === "recovery")) {
    try {
      const { error } = await client.auth.verifyOtp({ token_hash: tokenHash, type });
      if (!error) return type === "recovery" ? "/auth/reset-password" : "/auth/sign-in?notice=confirmed";
    } catch {
      // Never log or reflect one-time credentials in errors or destinations.
    }
  }
  return "/auth/sign-in?error=confirmation";
}
