export const membershipApplicationStatuses = ["new", "contacted", "invited", "declined"] as const;

export type MembershipApplicationStatus = (typeof membershipApplicationStatuses)[number];

export const membershipApplicationPageSize = 20;
export const membershipApplicationSearchMaxLength = 120;
export const membershipApplicationNoteMaxLength = 2000;
export const membershipApplicationReasonRange = { min: 5, max: 500 } as const;

// Contact details, motivation and the decision reason are null unless the viewer manages applications.
export type MembershipApplicationListItem = {
  id: string;
  fullName: string;
  occupation: string | null;
  status: MembershipApplicationStatus;
  submittedAt: string;
  updatedAt: string;
  email: string | null;
  phone: string | null;
  motivation: string | null;
  referralSource: string | null;
  decisionReason: string | null;
  invitedAt: string | null;
  accountCreated: boolean;
};

export type MembershipApplicationNote = {
  id: string;
  body: string;
  createdAt: string;
  author: string;
};

export type MembershipApplicationHistoryEntry = {
  id: string;
  fromStatus: MembershipApplicationStatus | null;
  toStatus: MembershipApplicationStatus;
  reason: string | null;
  actor: string;
  createdAt: string;
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
    return { ok: false, message: "Necesitamos tu autorización para usar estos datos al evaluar tu solicitud." };
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

// Returns the message for a reason that does not fit the status, or null when it is acceptable.
// Closing an application needs a reason; any other status accepts an optional comment.
export function membershipDecisionReasonError(status: MembershipApplicationStatus, reason: string) {
  const { min, max } = membershipApplicationReasonRange;
  const text = reason.trim();
  if (status === "declined" && (text.length < min || text.length > max)) {
    return `Escribe el motivo del cierre (${min} a ${max} caracteres).`;
  }
  if (text.length > max) return `El comentario admite hasta ${max} caracteres.`;
  return null;
}
