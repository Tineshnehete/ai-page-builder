/**
 * Cloudflare Pages API client
 *
 * Provides functions to create, deploy, and delete Cloudflare Pages projects.
 */

export interface CreateProjectResult {
  created: boolean;
  alreadyExists: boolean;
  subdomain?: string;
}

export interface DeployProjectResult {
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
 * Creates a new Cloudflare Pages project.
 *
 * @param accountId - Cloudflare account ID
 * @param apiToken - Cloudflare API token with Pages access
 * @param projectName - Name of the project to create
 * @returns Object with created flag, alreadyExists flag, and subdomain if successful
 * @throws Error if the request fails for reasons other than name already taken
 */
export async function createPagesProject(
  accountId: string,
  apiToken: string,
  projectName: string
): Promise<CreateProjectResult> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: projectName,
      production_branch: "main",
    }),
  });

  const data: CloudflareApiResponse<{ subdomain: string }> =
    await response.json();

  if (!data.success) {
    // Check if it's the "already exists" error
    if (
      data.errors &&
      data.errors.some((err) => err.code === 8000007)
    ) {
      return {
        created: false,
        alreadyExists: true,
      };
    }
    // For other errors, throw
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

/**
 * Deploys HTML content to a Cloudflare Pages project.
 *
 * @param accountId - Cloudflare account ID
 * @param apiToken - Cloudflare API token with Pages access
 * @param projectName - Name of the project to deploy to
 * @param html - HTML content to deploy
 * @returns Object with the deployment URL
 * @throws Error if the deployment fails
 */
export async function deployPagesProject(
  accountId: string,
  apiToken: string,
  projectName: string,
  html: string
): Promise<DeployProjectResult> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${projectName}/deployments`;

  // Create FormData for multipart/form-data request
  const formData = new FormData();

  // Add manifest (minimal required JSON)
  formData.append("manifest", new Blob([JSON.stringify({})], { type: "application/json" }), "manifest.json");

  // Add the HTML file
  formData.append("index.html", new Blob([html], { type: "text/html" }), "index.html");

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiToken}`,
    },
    body: formData,
  });

  const data: CloudflareApiResponse<{ url: string }> =
    await response.json();

  if (!data.success) {
    throw new Error(
      `Failed to deploy project: ${data.errors?.[0]?.message || "Unknown error"}`
    );
  }

  if (!data.result?.url) {
    throw new Error("Deploy succeeded but no URL returned");
  }

  return {
    url: data.result.url,
  };
}

/**
 * Deletes a Cloudflare Pages project.
 *
 * @param accountId - Cloudflare account ID
 * @param apiToken - Cloudflare API token with Pages access
 * @param projectName - Name of the project to delete
 * @returns Object with ok flag indicating success (true for 2xx, false otherwise)
 */
export async function deletePagesProject(
  accountId: string,
  apiToken: string,
  projectName: string
): Promise<DeleteProjectResult> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${projectName}`;

  const response = await fetch(url, {
    method: "DELETE",
    headers: {
      "Authorization": `Bearer ${apiToken}`,
    },
  });

  // Return ok:true for 2xx, ok:false for non-2xx
  return {
    ok: response.ok,
  };
}
