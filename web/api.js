// Thin fetch wrappers for the Worker API. No DOM manipulation here.

async function parseJsonOrThrow(response) {
  if (!response.ok) {
    let detail;
    try {
      detail = await response.json();
    } catch {
      detail = undefined;
    }
    const message = (detail && detail.error) || `Request failed with status ${response.status}`;
    throw new Error(message);
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
  return parseJsonOrThrow(response);
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
  return parseJsonOrThrow(response);
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

export async function streamChat(projectId, message, onChunk) {
  const response = await fetch(`/api/projects/${projectId}/chat`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });

  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
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
