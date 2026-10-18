import { getPlatformSnapshot } from "@/lib/platform";
import { PlatformWorkspace } from "./PlatformWorkspace";

export default async function PlatformPage({ searchParams }: { searchParams: Promise<{ tab?: string | string[] }> }) {
  const [snapshot, params] = await Promise.all([getPlatformSnapshot(), searchParams]);
  const tab = Array.isArray(params.tab) ? params.tab[0] : params.tab;
  return <PlatformWorkspace snapshot={snapshot} initialTab={tab} />;
}
