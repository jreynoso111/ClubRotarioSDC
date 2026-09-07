export function safeAuthNext(value: string | null | undefined) {
  if (!value || /[\\\u0000-\u001f]/.test(value)) return "/plataforma";
  if (value === "/auth/reset-password") return value;
  return /^\/plataforma(?:[/?#]|$)/.test(value) ? value : "/plataforma";
}
