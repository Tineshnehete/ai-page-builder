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
    // Routing for user record / project CRUD is left to the builder;
    // this is a scaffold stub so the project structure exists.
    return new Response("UserDO stub", { status: 501 });
  }
}
