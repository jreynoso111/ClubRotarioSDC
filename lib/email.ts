import "server-only";

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const DEFAULT_FROM = "Club Rotario Santo Domingo Colonial <no-reply@auth.clubrotariosdcolonial.org>";

export type ClubEmailContent = { subject: string; text: string; html: string };

// Sends one transactional message through Resend. It returns false instead of throwing
// when the key is missing or the request fails, so the caller decides what to report.
export async function sendClubEmail({ to, subject, text, html }: ClubEmailContent & { to: string }): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) return false;
  const from = process.env.CLUB_EMAIL_FROM?.trim() || DEFAULT_FROM;
  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject, text, html }),
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

const htmlEntities: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, character => htmlEntities[character]);
}

function page(paragraphs: string[]) {
  return `<div style="font-family:Georgia,'Times New Roman',serif;color:#1c2b3a;font-size:16px;line-height:1.6">${paragraphs.map(paragraph => `<p>${paragraph}</p>`).join("")}</div>`;
}

export function applicationReceivedEmail(fullName: string): ClubEmailContent {
  const greeting = `Hola ${fullName}:`;
  const closing = "Con gratitud,\nClub Rotario Santo Domingo Colonial";
  return {
    subject: "Recibimos tu solicitud para ser miembro",
    text: [
      greeting,
      "Gracias por tu interés en el Club Rotario Santo Domingo Colonial. Recibimos tu solicitud y la presidencia del club dará seguimiento.",
      "Te escribiremos a este mismo correo cuando haya novedades.",
      closing,
    ].join("\n\n"),
    html: page([
      escapeHtml(greeting),
      "Gracias por tu interés en el Club Rotario Santo Domingo Colonial. Recibimos tu solicitud y la presidencia del club dará seguimiento.",
      "Te escribiremos a este mismo correo cuando haya novedades.",
      escapeHtml(closing).replace(/\n/g, "<br>"),
    ]),
  };
}

export function applicationInvitationEmail(fullName: string, signUpUrl: string): ClubEmailContent {
  const greeting = `Hola ${fullName}:`;
  const closing = "Con gratitud,\nClub Rotario Santo Domingo Colonial";
  const instruction = "Para continuar, crea tu cuenta en este enlace usando exactamente este mismo correo electrónico:";
  const approval = "Cuando completes tu cuenta, el club aprobará tu membresía.";
  return {
    subject: "Te invitamos a unirte al Club Rotario Santo Domingo Colonial",
    text: [
      greeting,
      "La gestión del club revisó tu solicitud y te invitamos a formar parte de nuestra comunidad.",
      instruction,
      signUpUrl,
      approval,
      closing,
    ].join("\n\n"),
    html: page([
      escapeHtml(greeting),
      "La gestión del club revisó tu solicitud y te invitamos a formar parte de nuestra comunidad.",
      escapeHtml(instruction),
      `<a href="${escapeHtml(signUpUrl)}">Crear mi cuenta</a>`,
      escapeHtml(approval),
      escapeHtml(closing).replace(/\n/g, "<br>"),
    ]),
  };
}

type MemberNotice = { name: string; subject: string; paragraphs: string[]; link?: { url: string; label: string } };

// Membership notices share one layout: greeting, short paragraphs, an optional link and the club signature.
function memberNoticeEmail({ name, subject, paragraphs, link }: MemberNotice): ClubEmailContent {
  const greeting = `Hola ${name}:`;
  const closing = "Con gratitud,\nClub Rotario Santo Domingo Colonial";
  return {
    subject,
    text: [greeting, ...paragraphs, ...(link ? [`${link.label}: ${link.url}`] : []), closing].join("\n\n"),
    html: page([
      escapeHtml(greeting),
      ...paragraphs.map(paragraph => escapeHtml(paragraph)),
      ...(link ? [`<a href="${escapeHtml(link.url)}">${escapeHtml(link.label)}</a>`] : []),
      escapeHtml(closing).replace(/\n/g, "<br>"),
    ]),
  };
}

export function memberApprovedEmail(name: string, platformUrl: string): ClubEmailContent {
  return memberNoticeEmail({
    name,
    subject: "Tu membresía fue aprobada",
    paragraphs: ["La gestión del club aprobó tu membresía. Ya puedes entrar a la plataforma de miembros con la cuenta que creaste."],
    link: { url: platformUrl, label: "Entrar a la plataforma" },
  });
}

export function memberReactivatedEmail(name: string, platformUrl: string): ClubEmailContent {
  return memberNoticeEmail({
    name,
    subject: "Tu acceso a la plataforma fue reactivado",
    paragraphs: ["La gestión del club reactivó tu membresía. Tu acceso a la plataforma de miembros vuelve a estar disponible."],
    link: { url: platformUrl, label: "Entrar a la plataforma" },
  });
}

export function memberSuspendedEmail(name: string, reason: string): ClubEmailContent {
  return memberNoticeEmail({
    name,
    subject: "Tu acceso a la plataforma fue suspendido",
    paragraphs: [
      "La gestión del club suspendió temporalmente tu acceso a la plataforma de miembros.",
      `Motivo: ${reason}`,
      "Si tienes preguntas, comunícate con la gestión del club.",
    ],
  });
}

export function memberRoleChangedEmail(name: string, roleLabel: string): ClubEmailContent {
  return memberNoticeEmail({
    name,
    subject: "Actualizamos tu rol en la plataforma",
    paragraphs: [`La gestión del club cambió tu rol en la plataforma a ${roleLabel}.`, "Tus permisos se aplican la próxima vez que entres a la plataforma."],
  });
}

// Sent once when an administrator creates the account. The password is temporary:
// the first sign-in forces the member to choose their own before entering.
export function memberCredentialsEmail(name: string, email: string, temporaryPassword: string, signInUrl: string): ClubEmailContent {
  const greeting = `Hola ${name}:`;
  const welcome = "Bienvenido al Club Rotario Santo Domingo Colonial. La administración del club creó tu cuenta en la plataforma de miembros.";
  const credentials = ["Tus datos de acceso son:", `Correo: ${email}`, `Contraseña temporal: ${temporaryPassword}`];
  const change = "Al entrar por primera vez, el sistema te pedirá elegir una contraseña propia. La contraseña temporal deja de servir en cuanto la cambies.";
  const care = "No compartas este correo. Si no esperabas este mensaje, avisa a la administración del club.";
  const closing = "Con gratitud,\nClub Rotario Santo Domingo Colonial";
  return {
    subject: "Tu acceso a la plataforma del Club Rotario",
    text: [greeting, welcome, credentials.join("\n"), `Entra aquí: ${signInUrl}`, change, care, closing].join("\n\n"),
    html: page([
      escapeHtml(greeting),
      escapeHtml(welcome),
      `${escapeHtml(credentials[0])}<br>Correo: <strong>${escapeHtml(email)}</strong><br>Contraseña temporal: <strong>${escapeHtml(temporaryPassword)}</strong>`,
      `<a href="${escapeHtml(signInUrl)}">Entrar a la plataforma</a>`,
      escapeHtml(change),
      escapeHtml(care),
      escapeHtml(closing).replace(/\n/g, "<br>"),
    ]),
  };
}
