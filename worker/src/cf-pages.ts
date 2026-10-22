/**
 * Cloudflare Pages API client
 *
 * Provides functions to create, deploy, and delete Cloudflare Pages projects.
 *
 * NOTE: the request shapes here follow Cloudflare's publicly documented
 * Pages API and the direct-upload flow wrangler's `pages deploy` uses. They
 * have NOT been exercised against the live API from this codebase (no real
 * credentials in the dev/test environment) -- only against mocked
 * responses. Points of specific uncertainty are flagged inline with
 * "UNVERIFIED".
 */

const API_BASE = "https://api.cloudflare.com/client/v4";

/** Branch every deployment targets; matches the project's production_branch. */
const PRODUCTION_BRANCH = "main";

export interface CreateProjectResult {
  created: boolean;
  alreadyExists: boolean;
  subdomain?: string;
}

export interface DeployProjectResult {
  /** Per-deployment URL (changes on every deploy; not the stable URL). */
  url: string;
}

export interface DeleteProjectResult {
  ok: boolean;
}

interface CloudflareApiError {
  code: number;
  message: string;
}

interface CloudflareApiResponse<T> {
  success: boolean;
  result?: T;
  errors?: CloudflareApiError[];
}

/**
 * UNVERIFIED against the live API: the Cloudflare error code returned when
 * creating a Pages project whose name is already taken on the account. It
 * was carried over from the original implementation and has not been
 * confirmed (8000007 may in fact be Pages' "project not found" code). As a
 * fallback, an error whose message says the name "already exists" is also
 * treated as a name collision. Confirm against a real duplicate-create
 * response before relying on the code alone.
 */
export const PROJECT_NAME_TAKEN_CODE = 8000007;

/**
 * The stable production URL of a Pages project. The create-project API
 * returns `subdomain` as the full host (e.g. "my-site.pages.dev", which can
 * differ from the project name if that pages.dev label was taken); a bare
 * label is also tolerated. Falls back to `<projectName>.pages.dev`.
 */
export function stablePagesUrl(subdomain: string | undefined, projectName: string): string {
  const host = subdomain
    ? subdomain.includes(".")
      ? subdomain
      : `${subdomain}.pages.dev`
    : `${projectName}.pages.dev`;
  return `https://${host}`;
}

async function readCfResponse<T>(response: Response, what: string): Promise<T> {
  let data: CloudflareApiResponse<T>;
  try {
    data = (await response.json()) as CloudflareApiResponse<T>;
  } catch {
    throw new Error(`${what} failed: HTTP ${response.status}, non-JSON body`);
  }
  if (!response.ok || !data.success) {
    throw new Error(`${what} failed: ${data.errors?.[0]?.message || `HTTP ${response.status}`}`);
  }
  return data.result as T;
}

/**
 * Creates a new Cloudflare Pages project.
 *
 * @returns created/alreadyExists flags and, when created, the project's
 *   `subdomain` (its stable *.pages.dev host)
 * @throws Error if the request fails for reasons other than name already taken
 */
export async function createPagesProject(
  accountId: string,
  apiToken: string,
  projectName: string
): Promise<CreateProjectResult> {
  const url = `${API_BASE}/accounts/${accountId}/pages/projects`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: projectName,
      production_branch: PRODUCTION_BRANCH,
    }),
  });

  const data: CloudflareApiResponse<{ subdomain: string }> =
    await response.json();

  if (!data.success) {
    const nameTaken = (data.errors ?? []).some(
      (err) => err.code === PROJECT_NAME_TAKEN_CODE || /already exists/i.test(err.message ?? "")
    );
    if (nameTaken) {
      return {
        created: false,
        alreadyExists: true,
      };
    }
    throw new Error(
      `Failed to create project: ${data.errors?.[0]?.message || "Unknown error"}`
    );
  }

  return {
    created: true,
    alreadyExists: false,
    subdomain: data.result?.subdomain,
  };
}

function base64Encode(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/**
 * Content hash used as the asset key in the Pages asset store and manifest.
 *
 * UNVERIFIED: wrangler computes this as blake3(base64Content + extension),
 * hex, truncated to 32 chars. Blake3 isn't available in WebCrypto, so this
 * uses SHA-256 over the same input, truncated to the same length. The
 * hash appears to be a client-chosen content-addressing key (the same key
 * is used for check-missing, upload, upsert and the manifest), but whether
 * the API validates the algorithm has not been confirmed live. If it does,
 * swap in a blake3 implementation (e.g. a wasm build) here.
 */
export async function hashAsset(base64Content: string, extension: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(base64Content + extension)
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

/**
 * Deploys a single index.html to a Cloudflare Pages project's production
 * branch using the direct-upload flow:
 *
 * 1. GET  /accounts/:id/pages/projects/:name/upload-token -> upload JWT
 * 2. POST /pages/assets/check-missing  { hashes }         (JWT auth)
 * 3. POST /pages/assets/upload         [{ key, value, metadata, base64 }]
 *    (only if the asset is missing)
 * 4. POST /pages/assets/upsert-hashes  { hashes }         (JWT auth)
 * 5. POST /accounts/:id/pages/projects/:name/deployments
 *    multipart form: manifest = {"/index.html": hash}, branch = main
 *
 * @returns the per-deployment URL. Callers wanting the project's stable URL
 *   should use `stablePagesUrl` with the subdomain from project creation.
 * @throws Error if any step fails
 */
export async function deployPagesProject(
  accountId: string,
  apiToken: string,
  projectName: string,
  html: string
): Promise<DeployProjectResult> {
  const projectUrl = `${API_BASE}/accounts/${accountId}/pages/projects/${projectName}`;

  // 1. Upload token, scoped to this project's asset uploads.
  const tokenResult = await readCfResponse<{ jwt: string }>(
    await fetch(`${projectUrl}/upload-token`, {
      headers: { "Authorization": `Bearer ${apiToken}` },
    }),
    "Get upload token"
  );
  const jwt = tokenResult?.jwt;
  if (!jwt) {
    throw new Error("Get upload token failed: no jwt returned");
  }
  const jwtHeaders = {
    "Authorization": `Bearer ${jwt}`,
    "Content-Type": "application/json",
  };

  const base64Content = base64Encode(new TextEncoder().encode(html));
  const hash = await hashAsset(base64Content, "html");

  // 2. Which of our assets does Cloudflare not already have?
  const missing = await readCfResponse<string[]>(
    await fetch(`${API_BASE}/pages/assets/check-missing`, {
      method: "POST",
      headers: jwtHeaders,
      body: JSON.stringify({ hashes: [hash] }),
    }),
    "Check missing assets"
  );

  // 3. Upload the file content if needed.
  if (Array.isArray(missing) && missing.includes(hash)) {
    await readCfResponse<unknown>(
      await fetch(`${API_BASE}/pages/assets/upload`, {
        method: "POST",
        headers: jwtHeaders,
        body: JSON.stringify([
          {
            key: hash,
            value: base64Content,
            metadata: { contentType: "text/html" },
            base64: true,
          },
        ]),
      }),
      "Upload assets"
    );
  }

  // 4. Mark the hashes as in use.
  await readCfResponse<unknown>(
    await fetch(`${API_BASE}/pages/assets/upsert-hashes`, {
      method: "POST",
      headers: jwtHeaders,
      body: JSON.stringify({ hashes: [hash] }),
    }),
    "Upsert asset hashes"
  );

  // 5. Create the deployment from the manifest.
  const formData = new FormData();
  formData.append("manifest", JSON.stringify({ "/index.html": hash }));
  formData.append("branch", PRODUCTION_BRANCH);

  const deployment = await readCfResponse<{ url: string }>(
    await fetch(`${projectUrl}/deployments`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiToken}` },
      body: formData,
    }),
    "Create deployment"
  );

  if (!deployment?.url) {
    throw new Error("Deploy succeeded but no URL returned");
  }

  return { url: deployment.url };
}

/**
 * Deletes a Cloudflare Pages project.
 *
 * A 404 counts as success: the project being already gone (e.g. deleted
 * outside the app) is exactly the end state we want, and treating it as a
 * failure would make the app-side project permanently undeletable.
 *
 * @returns ok:true for 2xx or 404, ok:false otherwise
 */
export async function deletePagesProject(
  accountId: string,
  apiToken: string,
  projectName: string
): Promise<DeleteProjectResult> {
  const url = `${API_BASE}/accounts/${accountId}/pages/projects/${projectName}`;

  const response = await fetch(url, {
    method: "DELETE",
    headers: {
      "Authorization": `Bearer ${apiToken}`,
    },
  });

  return {
    ok: response.ok || response.status === 404,
  };
}
