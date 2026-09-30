"use server";

import { revalidatePath } from "next/cache";

import { parseMembershipApplication } from "@/lib/membership-applications";
import { isMissingSchemaError } from "@/lib/platform";
import { isSupabaseConfigured } from "@/utils/supabase/config";
import { createClient } from "@/utils/supabase/server";

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

  try {
    const supabase = await createClient();
    const { error } = await supabase.from("membership_applications").insert({
      full_name: parsed.value.fullName,
      email: parsed.value.email,
      phone: parsed.value.phone,
      occupation: parsed.value.occupation,
      motivation: parsed.value.motivation,
      referral_source: parsed.value.referralSource,
      consented_to_member_sharing: true,
    });

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
