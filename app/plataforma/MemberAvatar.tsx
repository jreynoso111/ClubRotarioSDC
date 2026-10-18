import Image from "next/image";

import { avatarRouteUrl, initialsFor } from "@/lib/account";

import styles from "./member-avatar.module.css";

// The photo comes from the avatar route; without one, the member's initials stay as before.
export function MemberAvatar({ userId, name, avatarVersion, className }: {
  userId: string;
  name: string;
  avatarVersion?: string | null;
  className?: string;
}) {
  if (avatarVersion) {
    return <span className={className}>
      <Image className={styles.image} src={avatarRouteUrl(userId, avatarVersion)} alt="" width={96} height={96} unoptimized />
    </span>;
  }
  return <span className={className}>{initialsFor(name)}</span>;
}
