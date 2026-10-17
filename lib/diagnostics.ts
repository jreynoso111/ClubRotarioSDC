// Shared vocabulary: never accept free-form messages or form contents from a browser.
export const diagnosticScopes = ["login", "recovery", "password", "signup", "confirmation", "mfa", "browser", "backend", "server", "test"] as const;
export type DiagnosticScope = typeof diagnosticScopes[number];
export const diagnosticCodes = {
  invalid_credentials: ["Credenciales rechazadas", "Revisar correo y contraseña; ofrecer recuperación de acceso."],
  email_not_confirmed: ["Correo sin confirmar", "Completar la confirmación del correo con un enlace vigente."],
  over_request_rate_limit: ["Demasiados intentos", "Esperar antes de repetir la operación."],
  over_email_send_rate_limit: ["Límite de correo alcanzado", "Esperar antes de solicitar otro correo."],
  otp_expired: ["Enlace vencido o utilizado", "Solicitar un nuevo enlace y abrir el más reciente."],
  session_not_found: ["Sesión no disponible", "Iniciar sesión de nuevo en el dominio canónico."],
  refresh_token_not_found: ["Sesión vencida", "Iniciar sesión de nuevo."],
  weak_password: ["Contraseña rechazada", "Comprobar los requisitos de la nueva contraseña."],
  same_password: ["Contraseña sin cambios", "Elegir una contraseña diferente de la anterior."],
  mfa_verification_failed: ["Código de verificación rechazado", "Usar el código actual de la aplicación y comprobar la hora del dispositivo."],
  mfa_challenge_expired: ["Verificación vencida", "Repetir la verificación en dos pasos con un código nuevo."],
  mfa_factor_not_found: ["Factor de verificación no disponible", "Volver a configurar la aplicación de autenticación."],
  mfa_totp_enroll_not_enabled: ["MFA desactivado en Auth", "Activar auth.mfa.totp en la configuración del backend."],
  insufficient_aal: ["Verificación en dos pasos requerida", "Completar la verificación en dos pasos antes de repetir la operación."],
  network_error: ["Conexión interrumpida", "Comprobar la red, Auth y la disponibilidad del backend."],
  backend_error: ["Error del backend", "Revisar el estado HTTP, el código de servicio y la ruta afectada."],
  unexpected_error: ["Error inesperado", "Relacionar la referencia y la hora con los registros del servidor."],
  hydration_error: ["HTML inicial y navegador diferentes", "Revisar fechas, formatos regionales y contenido que cambie entre el servidor y el navegador."],
  react_error: ["Error de renderizado de React", "Consultar el código de React y reproducir la pantalla afectada en desarrollo."],
  type_error: ["Operación JavaScript no válida", "Revisar el uso de valores nulos, tipos y dependencias en la pantalla afectada."],
  reference_error: ["Referencia JavaScript no disponible", "Revisar variables y dependencias de la pantalla afectada."],
  syntax_error: ["Contenido JavaScript no válido", "Revisar la versión del navegador y los recursos descargados."],
  resource_error: ["Recurso no disponible", "Comprobar la disponibilidad de los archivos de la página."],
  unhandled_rejection: ["Operación del navegador interrumpida", "Repetir la acción y revisar los errores del servidor a la misma hora."],
  csp_script: ["Script fuera de la política CSP", "Revisar el informe CSP en modo Report-Only antes de imponer la política."],
  csp_style: ["Estilo fuera de la política CSP", "Revisar estilos en línea o externos antes de imponer la política."],
  csp_connect: ["Conexión fuera de la política CSP", "Añadir el origen legítimo a connect-src o retirar la llamada."],
  csp_other: ["Recurso fuera de la política CSP", "Revisar la directiva afectada en el informe CSP."],
  test_event: ["Prueba de diagnóstico", "Registro de prueba solicitado por un administrador; no es un fallo real."],
} as const;
export type DiagnosticCode = keyof typeof diagnosticCodes;
export type DiagnosticEvent = {
  id: string; createdAt: string; source: "client" | "server"; scope: DiagnosticScope;
  code: DiagnosticCode; path: string; status?: number; serviceCode?: string;
  browser?: string; digest?: string; frames?: string[]; operation?: string; release?: string; reactCode?: string;
};
export function browserDiagnosticDetails(error: unknown): { code: DiagnosticCode; reactCode?: string } {
  if (!error || typeof error !== "object") return { code: "unexpected_error" };
  // Inspect locally; return fixed classifications only. Never transmit the message.
  const message = "message" in error && typeof error.message === "string" ? error.message : "";
  const reactCode = message.match(/Minified React error #(\d{1,4})\b/)?.[1];
  if (reactCode === "418" || /hydration failed|hydration mismatch/i.test(message)) return { code: "hydration_error", reactCode };
  if (reactCode) return { code: "react_error", reactCode };
  const name = "name" in error ? error.name : "";
  return { code: name === "TypeError" ? "type_error" : name === "ReferenceError" ? "reference_error" : name === "SyntaxError" ? "syntax_error" : "unexpected_error" };
}
const operations = ["render", "route", "action", "proxy", "auth", "profiles", "memberships", "events", "event_rsvps", "proposals", "proposal_votes", "activities", "tasks", "committees", "committee_members", "stories", "notifications", "internal_messages", "message_recipients", "finance_monthly_dues", "finance_entries", "membership_applications", "site_photo_slots", "audit_log", "rpc", "storage"];
export function diagnosticOperation(value: unknown) { return operations.includes(String(value)) ? String(value) : "service"; }
export function diagnosticCode(value: unknown): DiagnosticCode {
  return typeof value === "string" && Object.hasOwn(diagnosticCodes, value) ? value as DiagnosticCode : "unexpected_error";
}
export function diagnosticScope(value: unknown): DiagnosticScope {
  return diagnosticScopes.includes(value as DiagnosticScope) ? value as DiagnosticScope : "browser";
}
export function diagnosticPath(value: unknown) {
  // Known static routes only: paths may themselves contain names, tokens or personal data.
  const path = typeof value === "string" ? value.split(/[?#]/)[0] : "";
  return /^\/(?:auth\/(?:sign-in|sign-up|forgot-password|reset-password|complete|callback|confirm|mfa)|plataforma|api\/diagnostics|revista|agenda|nosotros|solicitar-membresia)?$/.test(path)
    ? path : "/[otra-ruta]";
}
export function browserFamily(agent: string) {
  if (/Edg\//.test(agent)) return "Edge";
  if (/Firefox\//.test(agent)) return "Firefox";
  if (/Chrome\//.test(agent)) return "Chrome";
  if (/Safari\//.test(agent)) return "Safari";
  return "Otro";
}
export function diagnosticStatus(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 400 && value <= 599 ? value : undefined;
}
export function canReadDiagnostics(membership: { membership_role?: string; membership_status?: string } | null) {
  return membership?.membership_role === "admin" && membership.membership_status === "active";
}
