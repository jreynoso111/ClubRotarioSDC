export const dynamic = "force-dynamic";

// Lets open tabs notice a new release (see PlatformVersionWatcher).
export function GET() {
  return Response.json({ deploymentId: process.env.CLUB_DEPLOYMENT_ID ?? "" }, { headers: { "Cache-Control": "no-store" } });
}
