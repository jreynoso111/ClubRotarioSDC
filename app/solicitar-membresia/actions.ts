"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { parseMembershipApplication } from "@/lib/membership-applications";
import { isMissingSchemaError } from "@/lib/platform";
import { isSupabaseConfigured } from "@/utils/supabase/config";
import { createClient } from "@/utils/supabase/server";
import { allowRequest } from "@/lib/rate-limit";
import { verifyTurnstileToken } from "@/lib/turnstile-server";

export type MembershipApplicationFormState = {
  ok: boolean;
  message: string;
};

export async function submitMembershipApplicationAction(
  _previousState: MembershipApplicationFormState,
  formData: FormData,
): Promise<MembershipApplicationFormState> {
  const honeypot = formData.get("website");
  if (typeof honeypot === "string" && honeypot.trim()) {
    return { ok: true, message: "Gracias por tu interés. El club se comunicará contigo si podemos continuar." };
  }

  const parsed = parseMembershipApplication({
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    phone: formData.get("phone"),
    occupation: formData.get("occupation"),
    motivation: formData.get("motivation"),
    referralSource: formData.get("referralSource"),
    consent: formData.get("consent"),
  });
  if (!parsed.ok) return { ok: false, message: parsed.message };
  if (!isSupabaseConfigured()) {
    return { ok: false, message: "El formulario no está disponible por el momento. Inténtalo más tarde." };
  }

  const remoteIp = (await headers()).get("cf-connecting-ip");
  const networkKey = createHash("sha256").update(remoteIp || "unknown").digest("hex");
  if (!allowRequest("membership-applications", "global", 40, 3600000) || !allowRequest("membership-applications", networkKey, 3, 3600000)) {
    return { ok: false, message: "Recibimos muchas solicitudes en poco tiempo. Inténtalo de nuevo más tarde." };
  }
  if (!(await verifyTurnstileToken(formData.get("cf-turnstile-response"), remoteIp))) {
    return { ok: false, message: "No pudimos confirmar la verificación de seguridad. Complétala e inténtalo de nuevo." };
  }

  try {
    const supabase = await createClient();
    // Direct table INSERT is revoked; this RPC validates consent and applies a club-wide limit.
    const { error } = await supabase.rpc("submit_membership_application", {
      _full_name: parsed.value.fullName,
      _email: parsed.value.email,
      _phone: parsed.value.phone,
      _occupation: parsed.value.occupation,
      _motivation: parsed.value.motivation,
      _referral_source: parsed.value.referralSource,
      _consent: true,
    });

    if (error?.code === "PT429") {
      return { ok: false, message: "Recibimos muchas solicitudes en poco tiempo. Inténtalo de nuevo más tarde." };
    }
    if (error?.code === "23505") {
      return { ok: false, message: "Ya hay una solicitud en curso con ese correo. El club se comunicará contigo." };
    }
    if (error) {
      return {
        ok: false,
        message: isMissingSchemaError(error)
          ? "Estamos preparando la recepción de solicitudes. Vuelve a intentarlo más adelante."
          : "No pudimos enviar tu solicitud. Revisa los datos e inténtalo nuevamente.",
      };
    }

    revalidatePath("/plataforma");
    return {
      ok: true,
      message: "Recibimos tu solicitud. Los miembros activos del club podrán conocerte y la presidencia dará seguimiento.",
    };
  } catch {
    return { ok: false, message: "No pudimos conectar. Comprueba tu conexión e inténtalo nuevamente." };
  }
}
