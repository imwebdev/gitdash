import { bootstrap } from "@/lib/bootstrap";
import { getStore } from "@/lib/state/store";
import { getCsrfToken } from "@/lib/security/csrf";
import { Dashboard } from "@/components/Dashboard";

export const dynamic = "force-dynamic";

export default async function Page() {
  await bootstrap();
  const initialRepos = getStore().snapshot(false);
  const csrfToken = getCsrfToken();
  return <Dashboard initialRepos={initialRepos} csrfToken={csrfToken} />;
}
