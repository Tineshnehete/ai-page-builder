// UserDO: one Durable Object instance per user (addressed by username).
// Holds that user's credentials and all of their projects (HTML, chat
// history, publish state) as a single JSON blob in DO storage.
// See docs/superpowers/specs/2026-10-22-ai-page-builder-design.md.

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

export interface Project {
  id: string;
  name: string;
  html: string;
  chatHistory: ChatMessage[];
  pagesProjectName: string | null;
  publishedUrl: string | null;
  everPublished: boolean;
}

export interface UserRecord {
  username: string;
  passwordHash: string;
  passwordSalt: string;
  projects: Project[];
}

export class UserDO {
  state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/internal/user") {
      if (request.method === "GET") {
        return this.handleGetUser();
      }
      if (request.method === "POST") {
        return this.handleCreateUser(request);
      }
    }

    if (url.pathname === "/internal/projects") {
      if (request.method === "GET") {
        return this.handleListProjects();
      }
      if (request.method === "POST") {
        return this.handleCreateProject(request);
      }
    }

    // Handle GET /internal/projects/:id
    const projectIdMatch = url.pathname.match(/^\/internal\/projects\/(.+)$/);
    if (projectIdMatch && request.method === "GET") {
      const projectId = projectIdMatch[1];
      return this.handleGetProject(projectId);
    }

    return new Response("Not found", { status: 404 });
  }

  private async handleGetUser(): Promise<Response> {
    const record = await this.state.storage.get<UserRecord>("user");
    if (!record) {
      return new Response("Not found", { status: 404 });
    }
    return Response.json(record);
  }

  private async handleCreateUser(request: Request): Promise<Response> {
    const existing = await this.state.storage.get<UserRecord>("user");
    if (existing) {
      return Response.json({ error: "username_taken" }, { status: 409 });
    }

    const body = (await request.json()) as {
      passwordHash: string;
      passwordSalt: string;
      // Not part of the documented wire contract: the DO's identity is its
      // username, taken from `this.state.id.name` (set when the caller used
      // `idFromName(username)`, as every real caller does). Some local test
      // runtimes don't propagate `id.name` into the DO instance, so this is
      // accepted as a fallback purely so the record can still be created and
      // addressed consistently in that environment; production callers never
      // need to send it, since `id.name` is always set there.
      username?: string;
    };

    const username = this.state.id.name ?? body.username;
    if (!username) {
      return Response.json({ error: "missing_username" }, { status: 400 });
    }

    const record: UserRecord = {
      username,
      passwordHash: body.passwordHash,
      passwordSalt: body.passwordSalt,
      projects: [],
    };

    await this.state.storage.put("user", record);

    return Response.json({ username: record.username }, { status: 201 });
  }

  private async handleListProjects(): Promise<Response> {
    const record = await this.state.storage.get<UserRecord>("user");
    const projects = record?.projects ?? [];
    return Response.json({
      projects: projects.map((p) => ({
        id: p.id,
        name: p.name,
        everPublished: p.everPublished,
        publishedUrl: p.publishedUrl,
      })),
    });
  }

  private async handleCreateProject(request: Request): Promise<Response> {
    const record = await this.state.storage.get<UserRecord>("user");
    if (!record) {
      return new Response("Not found", { status: 404 });
    }

    const body = (await request.json()) as { name: string };

    const project: Project = {
      id: crypto.randomUUID(),
      name: body.name,
      html: "",
      chatHistory: [],
      pagesProjectName: null,
      publishedUrl: null,
      everPublished: false,
    };

    record.projects.push(project);
    await this.state.storage.put("user", record);

    return Response.json({ project }, { status: 201 });
  }

  private async handleGetProject(projectId: string): Promise<Response> {
    const record = await this.state.storage.get<UserRecord>("user");
    if (!record) {
      return new Response("Not found", { status: 404 });
    }

    const project = record.projects.find((p) => p.id === projectId);
    if (!project) {
      return new Response("Not found", { status: 404 });
    }

    return Response.json({ project });
  }
}
