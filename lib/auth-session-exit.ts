"use client";

export async function endBrowserSession(all = false) {
  const response = await fetch(`/api/auth/sign-out${all ? "?all=1" : ""}`, { method: "POST", credentials: "same-origin" });
  if (!response.ok) throw new Error("session_exit_failed");
}
