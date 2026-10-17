import { reportClientDiagnostic } from "./lib/diagnostics-client";
import { browserDiagnosticDetails } from "./lib/diagnostics";

window.addEventListener("error", event => {
  const details = browserDiagnosticDetails(event.error);
  void reportClientDiagnostic("browser", undefined, event.target && event.target !== window ? "resource_error" : details.code, details.reactCode);
}, true);
window.addEventListener("unhandledrejection", event => {
  const details = browserDiagnosticDetails(event.reason);
  void reportClientDiagnostic("browser", undefined, details.code === "unexpected_error" ? "unhandled_rejection" : details.code, details.reactCode);
});
