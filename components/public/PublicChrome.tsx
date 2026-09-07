import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import styles from "./public.module.css";

export type PublicSection = "home" | "revista" | "eventos" | "nosotros";

const navigation = [
  { href: "/", label: "Inicio", section: "home" as const },
  { href: "/revista", label: "Revista", section: "revista" as const },
  { href: "/eventos", label: "Agenda", section: "eventos" as const },
  { href: "/nosotros", label: "El club", section: "nosotros" as const },
];

export function ArrowUpRight() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className={styles.icon}>
      <path d="M3 13 13 3M5 3h8v8" />
    </svg>
  );
}

export function ArrowLeft() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className={styles.icon}>
      <path d="M13 8H3M7 4 3 8l4 4" />
    </svg>
  );
}

export function ClubSignature({ compact = false }: { compact?: boolean }) {
  return (
    <span className={compact ? `${styles.signature} ${styles.signatureCompact}` : styles.signature}>
      <Image
        src="/club-santo-domingo-colonial-logo.png"
        alt="Rotary Club Santo Domingo Colonial"
        width={1401}
        height={310}
        priority={compact}
      />
    </span>
  );
}

export function PublicHeader({ active }: { active?: PublicSection }) {
  return (
    <header className={styles.header}>
      <Link className={styles.brand} href="/" aria-label="Club Rotario Santo Domingo Colonial, inicio">
        <ClubSignature compact />
      </Link>

      <nav className={styles.desktopNav} aria-label="Navegación principal">
        {navigation.map((item) => (
          <Link
            href={item.href}
            key={item.href}
            className={active === item.section ? styles.navActive : undefined}
            aria-current={active === item.section ? "page" : undefined}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      <Link className={styles.headerCta} href="/auth/sign-in?next=/plataforma">
        Acceso miembros <ArrowUpRight />
      </Link>

      <details className={styles.mobileMenu}>
        <summary aria-label="Abrir menú"><span /><span /></summary>
        <nav aria-label="Navegación móvil">
          {navigation.map((item) => (
            <Link
              href={item.href}
              key={item.href}
              className={active === item.section ? styles.navActive : undefined}
              aria-current={active === item.section ? "page" : undefined}
            >
              {item.label}
            </Link>
          ))}
          <Link href="/auth/sign-in?next=/plataforma">Acceso miembros</Link>
        </nav>
      </details>
    </header>
  );
}

export function PublicFooter() {
  return (
    <footer className={styles.footer}>
      <div className={styles.footerBrand}><ClubSignature /></div>
      <div className={styles.footerCopy}>
        <p>Servicio local. Vínculos que permanecen.</p>
        <small>Todos los derechos reservados · © {new Date().getFullYear()} Club Rotario Santo Domingo Colonial</small>
      </div>
      <Link className={styles.footerArrow} href="/" aria-label="Volver al inicio">
        <ArrowUpRight />
      </Link>
    </footer>
  );
}

export function PublicShell({
  active,
  children,
}: {
  active?: PublicSection;
  children: ReactNode;
}) {
  return (
    <div className={styles.page}>
      <PublicHeader active={active} />
      {children}
      <PublicFooter />
    </div>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className={styles.sectionLabel}>
      <span className={styles.sectionLabelLine} />
      {children}
    </p>
  );
}

export function CoverArt({
  src,
  alt,
  className,
  priority = false,
}: {
  src?: string | null;
  alt: string;
  className?: string;
  priority?: boolean;
}) {
  const coverClass = className ? `${styles.cover} ${className}` : styles.cover;

  if (src?.startsWith("/")) {
    return (
      <div className={coverClass}>
        <Image src={src} alt={alt} fill sizes="(max-width: 760px) 100vw, 50vw" priority={priority} />
      </div>
    );
  }

  if (src?.startsWith("https://")) {
    return (
      <div
        className={coverClass}
        role="img"
        aria-label={alt}
        style={{ backgroundImage: `url("${encodeURI(src).replaceAll('"', "%22")}")` }}
      />
    );
  }

  return <div className={coverClass} aria-label={alt} role="img" />;
}

export function formatLongDate(value: string | null | undefined) {
  if (!value) return "Fecha por confirmar";
  return new Intl.DateTimeFormat("es-DO", {
    dateStyle: "long",
    timeZone: "America/Santo_Domingo",
  }).format(new Date(value));
}

export function formatEventDate(value: string) {
  const date = new Date(value);
  return {
    day: new Intl.DateTimeFormat("es-DO", {
      day: "2-digit",
      timeZone: "America/Santo_Domingo",
    }).format(date),
    month: new Intl.DateTimeFormat("es-DO", {
      month: "short",
      timeZone: "America/Santo_Domingo",
    }).format(date).replaceAll(".", "").toUpperCase(),
    time: new Intl.DateTimeFormat("es-DO", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: "America/Santo_Domingo",
    }).format(date),
  };
}

export function ArrowLink({ href, children }: { href: string; children: ReactNode }) {
  return <Link className={styles.arrowLink} href={href}>{children}<ArrowUpRight /></Link>;
}
