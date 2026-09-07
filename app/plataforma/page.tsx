import { getPlatformSnapshot } from "@/lib/platform";
import { PlatformWorkspace } from "./PlatformWorkspace";

export default async function PlatformPage() {
  const snapshot = await getPlatformSnapshot();
  return <PlatformWorkspace snapshot={snapshot} />;
}
