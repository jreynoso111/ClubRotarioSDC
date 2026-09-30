export const membershipApplicationStatuses = ["new", "contacted", "invited", "declined"] as const;

export type MembershipApplicationStatus = (typeof membershipApplicationStatuses)[number];

export type MembershipApplication = {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  occupation: string | null;
  motivation: string;
  referral_source: string | null;
  status: MembershipApplicationStatus;
  submitted_at: string;
  updated_at: string;
};

export type MembershipApplicationInput = {
  fullName: unknown;
  email: unknown;
  phone: unknown;
  occupation: unknown;
  motivation: unknown;
  referralSource: unknown;
  consent: unknown;
};

export type ParsedMembershipApplication = {
  fullName: string;
  email: string;
  phone: string;
  occupation: string | null;
  motivation: string;
  referralSource: string | null;
};

export type MembershipApplicationParseResult =
  | { ok: true; value: ParsedMembershipApplication }
  | { ok: false; message: string };

function trimmedString(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function optionalField(value: unknown, maximum: number) {
  const text = trimmedString(value);
  if (text.length > maximum) return { ok: false as const, value: null };
  return { ok: true as const, value: text || null };
}

export function parseMembershipApplication(input: MembershipApplicationInput): MembershipApplicationParseResult {
  const fullName = trimmedString(input.fullName);
  const email = trimmedString(input.email).toLowerCase();
  const phone = typeof input.phone === "string" ? input.phone.trim() : "";
  const motivation = typeof input.motivation === "string" ? input.motivation.trim() : "";
  const occupation = optionalField(input.occupation, 120);
  const referralSource = optionalField(input.referralSource, 120);

  if (fullName.length < 2 || fullName.length > 120) {
    return { ok: false, message: "Escribe tu nombre completo (máximo 120 caracteres)." };
  }
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, message: "Escribe un correo electrónico válido." };
  }
  if (!/^[+0-9().\s-]{7,40}$/.test(phone) || phone.replace(/\D/g, "").length < 7) {
    return { ok: false, message: "Escribe un teléfono válido con al menos siete dígitos." };
  }
  if (motivation.length < 20 || motivation.length > 2000) {
    return { ok: false, message: "Cuéntanos qué te interesa del club (20 a 2,000 caracteres)." };
  }
  if (!occupation.ok || !referralSource.ok) {
    return { ok: false, message: "Revisa los campos opcionales; no deben superar 120 caracteres." };
  }
  if (input.consent !== true && input.consent !== "yes") {
    return { ok: false, message: "Necesitamos tu autorización para compartir estos datos con los miembros activos." };
  }

  return {
    ok: true,
    value: {
      fullName,
      email,
      phone,
      occupation: occupation.value,
      motivation,
      referralSource: referralSource.value,
    },
  };
}

export const membershipApplicationStatusLabels: Record<MembershipApplicationStatus, string> = {
  new: "Nueva",
  contacted: "Contactada",
  invited: "Invitada",
  declined: "Cerrada",
};
