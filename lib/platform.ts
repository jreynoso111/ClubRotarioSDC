import "server-only";

import { isSupabaseConfigured } from "@/utils/supabase/config";
import { createClient } from "@/utils/supabase/server";

export type PlatformRole =
  | "member"
  | "coordinator"
  | "editor"
  | "club_manager"
  | "admin";

export type PlatformAccess =
  | "active"
  | "pending"
  | "suspended"
  | "membership_missing"
  | "signed_out"
  | "unconfigured"
  | "backend_error";

export type PlatformSchemaState = "ready" | "migration_missing" | "unavailable";

export type PlatformSnapshot = {
  access: PlatformAccess;
  accessMessage: string;
  user: {
    id: string;
    email: string;
    displayName: string;
  } | null;
  membership: {
    role: PlatformRole;
    status: "pending" | "active" | "suspended";
    joinedAt: string | null;
    notes: string | null;
  } | null;
  capabilities: {
    canCoordinate: boolean;
    canEdit: boolean;
    canManageClub: boolean;
    canManageMembership: boolean;
    canBroadcast: boolean;
  };
  events: PlatformEvent[];
  eventRsvps: Record<string, string>;
  proposals: PlatformProposal[];
  activities: PlatformActivity[];
  tasks: PlatformTask[];
  committees: PlatformCommittee[];
  stories: PlatformStory[];
  notifications: PlatformNotification[];
  messages: PlatformMessage[];
  memberDirectory: PlatformDirectoryMember[];
  pendingMembers: PlatformPendingMember[];
  messagingSchema: {
    state: PlatformSchemaState;
    message: string | null;
  };
  dataWarnings: string[];
};

export type PlatformEvent = {
  id: string;
  title: string;
  summary: string | null;
  kind: string;
  tone: string;
  startsAt: string;
  endsAt: string | null;
  venueName: string | null;
  venueAddress: string | null;
  locationUrl: string | null;
  capacity: number | null;
  status: string;
  isPublic: boolean;
};

export type PlatformProposal = {
  id: string;
  title: string;
  summary: string;
  details: string;
  status: string;
  reviewNotes: string | null;
  createdBy: string;
  createdAt: string;
  submittedAt: string | null;
};

export type PlatformActivity = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  startsAt: string | null;
  endsAt: string | null;
  location: string | null;
  leadId: string | null;
};

export type PlatformTask = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  dueAt: string | null;
  activityId: string | null;
  proposalId: string | null;
  assigneeId: string | null;
};

export type PlatformCommittee = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  isActive: boolean;
  members: Array<{
    userId: string;
    name: string;
    role: string;
  }>;
};

export type PlatformStory = {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  content: string;
  storyType: string;
  status: string;
  isPublic: boolean;
  publishedAt: string | null;
  coverImagePath: string | null;
  authorId: string | null;
};

export type PlatformNotification = {
  id: string;
  kind: string;
  title: string;
  body: string;
  href: string | null;
  readAt: string | null;
  createdAt: string;
};

export type PlatformMessage = {
  id: string;
  subject: string;
  body: string;
  senderId: string;
  senderName: string;
  createdAt: string;
  readAt: string | null;
  direction: "inbox" | "sent";
  audienceType: string;
};

export type PlatformDirectoryMember = {
  userId: string;
  name: string;
};

export type PlatformPendingMember = {
  userId: string;
  name: string;
  role: PlatformRole;
  status: "pending" | "active" | "suspended";
  createdAt: string;
};

type PlatformError = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
};

type MembershipRow = {
  membership_role: string;
  membership_status: "pending" | "active" | "suspended";
  joined_at: string | null;
  notes: string | null;
};

type ProfileRow = {
  id: string;
  display_name: string | null;
};

type EventRow = {
  id: string;
  title: string;
  summary: string | null;
  kind: string;
  tone: string;
  starts_at: string;
  ends_at: string | null;
  venue_name: string | null;
  venue_address: string | null;
  location_url: string | null;
  capacity: number | null;
  status: string;
  is_public: boolean;
};

type ProposalRow = {
  id: string;
  title: string;
  summary: string;
  details: string;
  status: string;
  review_notes: string | null;
  created_by: string;
  created_at: string;
  submitted_at: string | null;
};

type ActivityRow = {
  id: string;
  title: string;
  description: string | null;
  activity_status: string;
  starts_at: string | null;
  ends_at: string | null;
  location: string | null;
  lead_id: string | null;
};

type TaskRow = {
  id: string;
  title: string;
  description: string | null;
  task_status: string;
  priority: string;
  due_at: string | null;
  activity_id: string | null;
  proposal_id: string | null;
  assignee_id: string | null;
};

type CommitteeRow = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  is_active: boolean;
};

type CommitteeMemberRow = {
  committee_id: string;
  user_id: string;
  committee_role: string;
};

type StoryRow = {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  content: string;
  story_type: string;
  status: string;
  is_public: boolean;
  published_at: string | null;
  cover_image_path: string | null;
  author_id: string | null;
};

type NotificationRow = {
  id: string;
  kind: string;
  title: string;
  body: string;
  href: string | null;
  read_at: string | null;
  created_at: string;
};

type MessageRow = {
  id: string;
  subject: string;
  body: string;
  sender_id: string;
  audience_type: string;
  created_at: string;
};

type MessageRecipientRow = {
  message_id: string;
  read_at: string | null;
  created_at: string;
};

type PendingMembershipRow = {
  user_id: string;
  membership_role: string;
  membership_status: "pending" | "active" | "suspended";
  created_at: string;
};

function asRole(value: string | null | undefined): PlatformRole {
  if (
    value === "coordinator" ||
    value === "editor" ||
    value === "club_manager" ||
    value === "admin"
  ) {
    return value;
  }

  return "member";
}

export function isMissingSchemaError(error: PlatformError | null | undefined) {
  if (!error) return false;
  const message = `${error.code ?? ""} ${error.message ?? ""}`.toLowerCase();
  return (
    error.code === "42P01" ||
    error.code === "42703" ||
    error.code === "PGRST202" ||
    error.code === "PGRST205" ||
    message.includes("does not exist") ||
    message.includes("could not find the table") ||
    message.includes("could not find the function")
  );
}

function describeError(error: PlatformError | null | undefined) {
  return error?.message || "No se pudo cargar este módulo.";
}

async function readQuery<T>(
  request: PromiseLike<{ data: T | null; error: PlatformError | null }>,
) {
  try {
    return await request;
  } catch (error) {
    return {
      data: null,
      error: {
        message: error instanceof Error ? error.message : "No se pudo completar la consulta.",
      },
    } satisfies { data: T | null; error: PlatformError | null };
  }
}

function emptySnapshot(
  access: PlatformAccess,
  accessMessage: string,
  user: PlatformSnapshot["user"] = null,
): PlatformSnapshot {
  return {
    access,
    accessMessage,
    user,
    membership: null,
    capabilities: {
      canCoordinate: false,
      canEdit: false,
      canManageClub: false,
      canManageMembership: false,
      canBroadcast: false,
    },
    events: [],
    eventRsvps: {},
    proposals: [],
    activities: [],
    tasks: [],
    committees: [],
    stories: [],
    notifications: [],
    messages: [],
    memberDirectory: [],
    pendingMembers: [],
    messagingSchema: {
      state: "unavailable",
      message: null,
    },
    dataWarnings: [],
  };
}

export async function getPlatformSnapshot(): Promise<PlatformSnapshot> {
  if (!isSupabaseConfigured()) {
    return emptySnapshot(
      "unconfigured",
      "Faltan las variables públicas de Supabase para abrir la plataforma.",
    );
  }

  let supabase;
  try {
    supabase = await createClient();
  } catch (error) {
    return emptySnapshot(
      "backend_error",
      error instanceof Error ? error.message : "No se pudo configurar la conexión del club.",
    );
  }

  const { data: userData, error: userError } = await supabase.auth.getUser();
  const user = userData?.user;
  if (userError || !user) {
    return emptySnapshot("signed_out", "Inicia sesión para entrar a la plataforma.");
  }

  const [profileResult, membershipResult] = await Promise.all([
    readQuery<ProfileRow>(
      supabase.from("profiles").select("id,display_name").eq("id", user.id).maybeSingle(),
    ),
    readQuery<MembershipRow>(
      supabase
        .from("memberships")
        .select("membership_role,membership_status,joined_at,notes")
        .eq("user_id", user.id)
        .maybeSingle(),
    ),
  ]);

  if (membershipResult.error) {
    return emptySnapshot(
      "backend_error",
      isMissingSchemaError(membershipResult.error)
        ? "La base de datos del club todavía no tiene la estructura de membresías aplicada."
        : describeError(membershipResult.error),
      {
        id: user.id,
        email: user.email ?? "",
        displayName: user.email ?? "Miembro del club",
      },
    );
  }

  const profile = profileResult.data;
  const displayName =
    profile?.display_name?.trim() || user.user_metadata?.display_name?.trim() || user.email || "Miembro del club";
  const snapshotUser = {
    id: user.id,
    email: user.email ?? "",
    displayName,
  };

  if (!membershipResult.data) {
    return emptySnapshot(
      "membership_missing",
      "Tu cuenta no tiene una membresía asociada. Solicita al club que revise tu acceso.",
      snapshotUser,
    );
  }

  const membership = membershipResult.data;
  const role = asRole(membership.membership_role);
  const isActive = membership.membership_status === "active";
  const capabilities = {
    canCoordinate: isActive && ["coordinator", "club_manager", "admin"].includes(role),
    canEdit: isActive && ["editor", "club_manager", "admin"].includes(role),
    canManageClub: isActive && ["club_manager", "admin"].includes(role),
    canManageMembership: isActive && ["club_manager", "admin"].includes(role),
    canBroadcast: isActive && ["coordinator", "club_manager", "admin"].includes(role),
  };
  const baseSnapshot = emptySnapshot(
    isActive ? "active" : membership.membership_status,
    isActive
      ? "Tu membresía está activa."
      : membership.membership_status === "pending"
        ? "Tu solicitud está pendiente de revisión por el club."
        : "Tu membresía está suspendida. Contacta al club para revisar tu acceso.",
    snapshotUser,
  );

  baseSnapshot.membership = {
    role,
    status: membership.membership_status,
    joinedAt: membership.joined_at,
    notes: membership.notes,
  };
  baseSnapshot.capabilities = capabilities;

  if (!isActive) {
    return baseSnapshot;
  }

  const proposalsQuery = capabilities.canCoordinate
    ? supabase
        .from("proposals")
        .select("id,title,summary,details,status,review_notes,created_by,created_at,submitted_at")
        .order("created_at", { ascending: false })
        .limit(30)
    : supabase
        .from("proposals")
        .select("id,title,summary,details,status,review_notes,created_by,created_at,submitted_at")
        .eq("created_by", user.id)
        .order("created_at", { ascending: false })
        .limit(30);

  const [
    eventsResult,
    proposalsResult,
    activitiesResult,
    tasksResult,
    committeesResult,
    committeeMembersResult,
    storiesResult,
    notificationsResult,
    directoryResult,
  ] = await Promise.all([
    readQuery<EventRow[]>(
      supabase
        .from("events")
        .select(
          "id,title,summary,kind,tone,starts_at,ends_at,venue_name,venue_address,location_url,capacity,status,is_public",
        )
        .order("starts_at", { ascending: true, nullsFirst: false })
        .limit(30),
    ),
    readQuery<ProposalRow[]>(proposalsQuery),
    readQuery<ActivityRow[]>(
      supabase
        .from("activities")
        .select("id,title,description,activity_status,starts_at,ends_at,location,lead_id")
        .order("starts_at", { ascending: true, nullsFirst: false })
        .limit(20),
    ),
    readQuery<TaskRow[]>(
      supabase
        .from("tasks")
        .select("id,title,description,task_status,priority,due_at,activity_id,proposal_id,assignee_id")
        .in("task_status", ["todo", "in_progress", "blocked"])
        .order("due_at", { ascending: true, nullsFirst: false })
        .limit(30),
    ),
    readQuery<CommitteeRow[]>(
      supabase
        .from("committees")
        .select("id,name,slug,description,is_active")
        .eq("is_active", true)
        .order("name", { ascending: true })
        .limit(30),
    ),
    readQuery<CommitteeMemberRow[]>(
      supabase.from("committee_members").select("committee_id,user_id,committee_role").limit(200),
    ),
    readQuery<StoryRow[]>(
      supabase
        .from("stories")
        .select("id,title,slug,excerpt,content,story_type,status,is_public,published_at,cover_image_path,author_id")
        .order("updated_at", { ascending: false })
        .limit(30),
    ),
    readQuery<NotificationRow[]>(
      supabase
        .from("notifications")
        .select("id,kind,title,body,href,read_at,created_at")
        .order("created_at", { ascending: false })
        .limit(20),
    ),
    readQuery<ProfileRow[]>(
      supabase.from("profiles").select("id,display_name").order("display_name", { ascending: true }).limit(200),
    ),
  ]);

  const warnings: string[] = [];
  const existingResults = [
    [eventsResult, "agenda"],
    [proposalsResult, "propuestas"],
    [activitiesResult, "actividades"],
    [tasksResult, "tareas"],
    [committeesResult, "comités"],
    [committeeMembersResult, "integrantes de comités"],
    [storiesResult, "publicaciones"],
    [directoryResult, "directorio"],
  ] as const;
  for (const [result, label] of existingResults) {
    if (result.error && !isMissingSchemaError(result.error)) {
      warnings.push(`${label}: ${describeError(result.error)}`);
    }
  }

  const events = ((eventsResult.data ?? []) as EventRow[]).map((event) => ({
    id: event.id,
    title: event.title,
    summary: event.summary,
    kind: event.kind,
    tone: event.tone,
    startsAt: event.starts_at,
    endsAt: event.ends_at,
    venueName: event.venue_name,
    venueAddress: event.venue_address,
    locationUrl: event.location_url,
    capacity: event.capacity,
    status: event.status,
    isPublic: event.is_public,
  }));
  const eventRsvps: Record<string, string> = {};
  if (events.length > 0) {
    const rsvpResult = await readQuery<Array<{ event_id: string; rsvp_status: string }>>(
      supabase
        .from("event_rsvps")
        .select("event_id,rsvp_status")
        .eq("user_id", user.id)
        .in("event_id", events.map((event) => event.id)),
    );
    if (rsvpResult.error && !isMissingSchemaError(rsvpResult.error)) {
      warnings.push(`asistencia: ${describeError(rsvpResult.error)}`);
    }
    for (const rsvp of rsvpResult.data ?? []) eventRsvps[rsvp.event_id] = rsvp.rsvp_status;
  }

  const directory = ((directoryResult.data ?? []) as ProfileRow[]).map((row) => ({
    userId: row.id,
    name: row.display_name?.trim() || "Miembro del club",
  }));
  const names = new Map(directory.map((member) => [member.userId, member.name]));
  const committeeMembers = (committeeMembersResult.data ?? []) as CommitteeMemberRow[];
  const committees = ((committeesResult.data ?? []) as CommitteeRow[]).map((committee) => ({
    id: committee.id,
    name: committee.name,
    slug: committee.slug,
    description: committee.description,
    isActive: committee.is_active,
    members: committeeMembers
      .filter((member) => member.committee_id === committee.id)
      .map((member) => ({
        userId: member.user_id,
        name: names.get(member.user_id) ?? "Miembro del club",
        role: member.committee_role,
      })),
  }));

  const messagingQueryResults: Array<{ error: PlatformError | null }> = [notificationsResult];
  let messagingState: PlatformSchemaState = "ready";
  let messagingMessage: string | null = null;
  if (notificationsResult.error) {
    if (isMissingSchemaError(notificationsResult.error)) {
      messagingState = "migration_missing";
      messagingMessage =
        "La mensajería y los avisos están preparados en la interfaz, pero requieren aplicar la migración member_platform_messaging_notifications en Supabase.";
    } else {
      messagingState = "unavailable";
      messagingMessage = describeError(notificationsResult.error);
      warnings.push(`avisos: ${describeError(notificationsResult.error)}`);
    }
  }

  const [recipientResult, sentResult] = await Promise.all([
    readQuery<MessageRecipientRow[]>(
      supabase
        .from("internal_message_recipients")
        .select("message_id,read_at,created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(30),
    ),
    readQuery<MessageRow[]>(
      supabase
        .from("internal_messages")
        .select("id,subject,body,sender_id,audience_type,created_at")
        .eq("sender_id", user.id)
        .order("created_at", { ascending: false })
        .limit(30),
    ),
  ]);
  messagingQueryResults.push(recipientResult, sentResult);
  const messagingErrors = [recipientResult.error, sentResult.error].filter(Boolean) as PlatformError[];
  if (messagingErrors.some((error) => isMissingSchemaError(error))) {
    messagingState = "migration_missing";
    messagingMessage =
      "La mensajería y los avisos están preparados en la interfaz, pero requieren aplicar la migración member_platform_messaging_notifications en Supabase.";
  } else if (messagingErrors.length > 0) {
    messagingState = "unavailable";
    messagingMessage = describeError(messagingErrors[0]);
    warnings.push(`mensajería: ${messagingMessage}`);
  }

  const recipientRows = (recipientResult.data ?? []) as MessageRecipientRow[];
  const receivedIds = recipientRows.map((row) => row.message_id);
  let receivedRows: MessageRow[] = [];
  if (receivedIds.length > 0 && messagingState === "ready") {
    const receivedResult = await readQuery<MessageRow[]>(
      supabase
        .from("internal_messages")
        .select("id,subject,body,sender_id,audience_type,created_at")
        .in("id", receivedIds),
    );
    if (receivedResult.error) {
      if (isMissingSchemaError(receivedResult.error)) {
        messagingState = "migration_missing";
        messagingMessage =
          "La mensajería y los avisos están preparados en la interfaz, pero requieren aplicar la migración member_platform_messaging_notifications en Supabase.";
      } else {
        warnings.push(`buzón: ${describeError(receivedResult.error)}`);
      }
    }
    receivedRows = (receivedResult.data ?? []) as MessageRow[];
  }
  const readByMessage = new Map(recipientRows.map((row) => [row.message_id, row.read_at]));
  const messages: PlatformMessage[] = [
    ...receivedRows.map((message) => ({
      id: message.id,
      subject: message.subject,
      body: message.body,
      senderId: message.sender_id,
      senderName: names.get(message.sender_id) ?? "Miembro del club",
      createdAt: message.created_at,
      readAt: readByMessage.get(message.id) ?? null,
      direction: "inbox" as const,
      audienceType: message.audience_type,
    })),
    ...((sentResult.data ?? []) as MessageRow[]).map((message) => ({
      id: message.id,
      subject: message.subject,
      body: message.body,
      senderId: message.sender_id,
      senderName: displayName,
      createdAt: message.created_at,
      readAt: null,
      direction: "sent" as const,
      audienceType: message.audience_type,
    })),
  ].sort((left, right) => right.createdAt.localeCompare(left.createdAt));

  let pendingMembers: PlatformPendingMember[] = [];
  if (capabilities.canManageMembership) {
    const pendingResult = await readQuery<PendingMembershipRow[]>(
      supabase
        .from("memberships")
        .select("user_id,membership_role,membership_status,created_at")
        .eq("membership_status", "pending")
        .order("created_at", { ascending: true })
        .limit(50),
    );
    if (pendingResult.error) {
      if (!isMissingSchemaError(pendingResult.error)) {
        warnings.push(`solicitudes: ${describeError(pendingResult.error)}`);
      }
    } else {
      const pendingRows = (pendingResult.data ?? []) as PendingMembershipRow[];
      const pendingIds = pendingRows.map((row) => row.user_id);
      let pendingProfiles: ProfileRow[] = [];
      if (pendingIds.length > 0) {
        const pendingProfilesResult = await readQuery<ProfileRow[]>(
          supabase.from("profiles").select("id,display_name").in("id", pendingIds),
        );
        pendingProfiles = (pendingProfilesResult.data ?? []) as ProfileRow[];
      }
      const pendingNames = new Map(
        pendingProfiles.map((profileRow) => [profileRow.id, profileRow.display_name?.trim() || "Nueva solicitud"]),
      );
      pendingMembers = pendingRows.map((row) => ({
        userId: row.user_id,
        name: pendingNames.get(row.user_id) ?? "Nueva solicitud",
        role: asRole(row.membership_role),
        status: row.membership_status,
        createdAt: row.created_at,
      }));
    }
  }

  // A missing notification table is the signal for the whole additive migration,
  // even if another query returned an empty result while the API cache refreshed.
  if (messagingQueryResults.some((result) => result.error && isMissingSchemaError(result.error))) {
    messagingState = "migration_missing";
    messagingMessage =
      "La mensajería y los avisos están preparados en la interfaz, pero requieren aplicar la migración member_platform_messaging_notifications en Supabase.";
  }

  return {
    ...baseSnapshot,
    events,
    eventRsvps,
    proposals: ((proposalsResult.data ?? []) as ProposalRow[]).map((proposal) => ({
      id: proposal.id,
      title: proposal.title,
      summary: proposal.summary,
      details: proposal.details,
      status: proposal.status,
      reviewNotes: proposal.review_notes,
      createdBy: proposal.created_by,
      createdAt: proposal.created_at,
      submittedAt: proposal.submitted_at,
    })),
    activities: ((activitiesResult.data ?? []) as ActivityRow[]).map((activity) => ({
      id: activity.id,
      title: activity.title,
      description: activity.description,
      status: activity.activity_status,
      startsAt: activity.starts_at,
      endsAt: activity.ends_at,
      location: activity.location,
      leadId: activity.lead_id,
    })),
    tasks: ((tasksResult.data ?? []) as TaskRow[]).map((task) => ({
      id: task.id,
      title: task.title,
      description: task.description,
      status: task.task_status,
      priority: task.priority,
      dueAt: task.due_at,
      activityId: task.activity_id,
      proposalId: task.proposal_id,
      assigneeId: task.assignee_id,
    })),
    committees,
    stories: ((storiesResult.data ?? []) as StoryRow[]).map((story) => ({
      id: story.id,
      title: story.title,
      slug: story.slug,
      excerpt: story.excerpt,
      content: story.content,
      storyType: story.story_type,
      status: story.status,
      isPublic: story.is_public,
      publishedAt: story.published_at,
      coverImagePath: story.cover_image_path,
      authorId: story.author_id,
    })),
    notifications: ((notificationsResult.data ?? []) as NotificationRow[]).map((notification) => ({
      id: notification.id,
      kind: notification.kind,
      title: notification.title,
      body: notification.body,
      href: notification.href,
      readAt: notification.read_at,
      createdAt: notification.created_at,
    })),
    messages,
    memberDirectory: directory,
    pendingMembers,
    messagingSchema: {
      state: messagingState,
      message: messagingMessage,
    },
    dataWarnings: warnings,
  };
}
