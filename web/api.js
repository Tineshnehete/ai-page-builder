// Thin fetch wrappers for the Worker API. No DOM manipulation here.

async function errorMessageFor(response) {
  let detail;
  try {
    detail = await response.json();
  } catch {
    detail = undefined;
  }
  return (detail && detail.error) || `Request failed with status ${response.status}`;
}

// Errors thrown for non-2xx responses carry the HTTP `status`, so callers
// can tell an expired/missing session (401) apart from other failures.
async function httpError(response) {
  const error = new Error(await errorMessageFor(response));
  error.status = response.status;
  return error;
}

export function isUnauthorized(err) {
  return Boolean(err) && err.status === 401;
}

async function parseJsonOrThrow(response) {
  if (!response.ok) {
    throw await httpError(response);
  }
  return response.json();
}

export async function register(username, password) {
  const response = await fetch("/api/register", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  return parseJsonOrThrow(response);
}

export async function login(username, password) {
  const response = await fetch("/api/login", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  return parseJsonOrThrow(response);
}

export async function logout() {
  const response = await fetch("/api/logout", {
    method: "POST",
    credentials: "include",
  });
  return parseJsonOrThrow(response);
}

export async function listProjects() {
  const response = await fetch("/api/projects", {
    credentials: "include",
  });
  const { projects } = await parseJsonOrThrow(response);
  return projects;
}

export async function createProject(name) {
  const response = await fetch("/api/projects", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  const { project } = await parseJsonOrThrow(response);
  return project;
}

export async function getProject(id) {
  const response = await fetch(`/api/projects/${id}`, {
    credentials: "include",
  });
  const { project } = await parseJsonOrThrow(response);
  return project;
}

export async function deleteProject(id) {
  const response = await fetch(`/api/projects/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
  return parseJsonOrThrow(response);
}

export async function publishProject(id) {
  const response = await fetch(`/api/projects/${id}/publish`, {
    method: "POST",
    credentials: "include",
  });
  return parseJsonOrThrow(response);
}

export async function streamChat(projectId, message, onChunk, style) {
  const response = await fetch(`/api/projects/${projectId}/chat`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(style === undefined ? { message } : { message, style }),
  });

  if (!response.ok) {
    throw await httpError(response);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let full = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const text = decoder.decode(value, { stream: true });
    full += text;
    onChunk(text);
  }

  return full;
}
