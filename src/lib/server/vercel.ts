/**
 * Vercel API client — registers / detaches tenant subdomains on the project
 * so TLS provisions automatically when a new tenant is onboarded.
 *
 * Pre-condition: a wildcard CNAME (`*.cgtsync.ai → cname.vercel-dns.com`)
 * must exist in DNS so Vercel can resolve any tenant subdomain.
 *
 * Soft-skip pattern: if `VERCEL_API_TOKEN` is unset, both functions return
 * `{ added/removed: false, error: null }` so local dev and CI keep working
 * without configuring Vercel credentials.
 */

const VERCEL_API_BASE = "https://api.vercel.com";
const VERCEL_API_TIMEOUT_MS = 10_000;

interface VercelErrorBody {
  error?: { code?: string; message?: string };
}

function vercelEnv(): {
  token: string | null;
  projectId: string | null;
  teamId: string | null;
} {
  return {
    token: process.env.VERCEL_API_TOKEN ?? null,
    projectId: process.env.VERCEL_PROJECT_ID ?? null,
    teamId: process.env.VERCEL_TEAM_ID ?? null,
  };
}

function withTeam(url: URL, teamId: string | null): URL {
  if (teamId) url.searchParams.set("teamId", teamId);
  return url;
}

async function parseErrorBody(res: Response): Promise<VercelErrorBody> {
  try {
    return (await res.json()) as VercelErrorBody;
  } catch {
    return {};
  }
}

export async function addProjectDomain(
  domain: string,
): Promise<{ added: boolean; error: string | null }> {
  const { token, projectId, teamId } = vercelEnv();

  if (!token) {
    console.info("[vercel] domain registration skipped: no VERCEL_API_TOKEN");
    return { added: false, error: null };
  }
  if (!projectId) {
    return { added: false, error: "VERCEL_PROJECT_ID not set" };
  }

  const url = withTeam(
    new URL(`${VERCEL_API_BASE}/v10/projects/${projectId}/domains`),
    teamId,
  );

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: domain }),
      signal: AbortSignal.timeout(VERCEL_API_TIMEOUT_MS),
    });
  } catch (e) {
    return {
      added: false,
      error: `Vercel API unreachable: ${e instanceof Error ? e.message : "unknown"}`,
    };
  }

  if (res.ok) return { added: true, error: null };

  const body = await parseErrorBody(res);
  const code = body?.error?.code;
  const message = body?.error?.message;

  if (
    res.status === 409 &&
    code === "domain_already_in_use_by_this_project"
  ) {
    return { added: true, error: null };
  }
  if (res.status === 401) {
    return {
      added: false,
      error: "Vercel auth failed (check VERCEL_API_TOKEN)",
    };
  }
  if (res.status === 403) {
    return {
      added: false,
      error: "Vercel forbidden (check VERCEL_PROJECT_ID / VERCEL_TEAM_ID scope)",
    };
  }
  if (res.status === 404) {
    return { added: false, error: "Vercel project not found" };
  }
  return {
    added: false,
    error: `Vercel error ${res.status}: ${message ?? code ?? "unknown"}`,
  };
}

export async function removeProjectDomain(
  domain: string,
): Promise<{ removed: boolean; error: string | null }> {
  const { token, projectId, teamId } = vercelEnv();

  if (!token) {
    console.info("[vercel] domain removal skipped: no VERCEL_API_TOKEN");
    return { removed: false, error: null };
  }
  if (!projectId) {
    return { removed: false, error: "VERCEL_PROJECT_ID not set" };
  }

  const url = withTeam(
    new URL(
      `${VERCEL_API_BASE}/v9/projects/${projectId}/domains/${encodeURIComponent(domain)}`,
    ),
    teamId,
  );

  let res: Response;
  try {
    res = await fetch(url, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(VERCEL_API_TIMEOUT_MS),
    });
  } catch (e) {
    return {
      removed: false,
      error: `Vercel API unreachable: ${e instanceof Error ? e.message : "unknown"}`,
    };
  }

  if (res.ok || res.status === 404) {
    return { removed: true, error: null };
  }

  const body = await parseErrorBody(res);
  const message = body?.error?.message;

  if (res.status === 401) {
    return {
      removed: false,
      error: "Vercel auth failed (check VERCEL_API_TOKEN)",
    };
  }
  if (res.status === 403) {
    return {
      removed: false,
      error: "Vercel forbidden (check VERCEL_PROJECT_ID / VERCEL_TEAM_ID scope)",
    };
  }
  return {
    removed: false,
    error: `Vercel error ${res.status}: ${message ?? "unknown"}`,
  };
}
