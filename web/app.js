// App shell: auth, projects list, and editor views.
// Plain DOM manipulation, no framework/bundler. See
// docs/superpowers/specs/2026-10-22-ai-page-builder-design.md for the
// product spec this implements against.

import {
  register,
  login,
  logout,
  listProjects,
  createProject,
  getProject,
  deleteProject,
  publishProject,
  streamChat,
  isUnauthorized,
} from "./api.js";
import { renderPreview } from "./preview.js";

const app = document.getElementById("app");

// ---------------------------------------------------------------------------
// Small DOM helpers
// ---------------------------------------------------------------------------

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "className") {
      node.className = value;
    } else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value !== null && value !== undefined) {
      node.setAttribute(key, value);
    }
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function mount(node) {
  clear(app);
  app.appendChild(node);
}

// Shared handling for a missing/expired session anywhere in the app: any
// API call that comes back 401 sends the user back to the login screen
// instead of leaving them on a dead-end "unauthorized" error. Returns true
// if it handled the error, so callers can skip their own error display.
function handleSessionExpired(err) {
  if (!isUnauthorized(err)) return false;
  renderAuthView("Your session has expired. Please log in again.");
  return true;
}

// ---------------------------------------------------------------------------
// Auth view
// ---------------------------------------------------------------------------

function renderAuthView(notice = "") {
  let mode = "login"; // "login" | "register"

  const errorEl = el("p", { className: "error", role: "alert" }, notice ? [notice] : []);

  const usernameInput = el("input", {
    type: "text",
    name: "username",
    autocomplete: "username",
    required: "required",
  });
  const passwordInput = el("input", {
    type: "password",
    name: "password",
    autocomplete: "current-password",
    required: "required",
  });

  const submitBtn = el("button", { type: "submit", className: "btn btn-primary" }, ["Log in"]);

  const loginTab = el("button", { type: "button", className: "tab active" }, ["Log in"]);
  const registerTab = el("button", { type: "button", className: "tab" }, ["Register"]);

  function setMode(next) {
    mode = next;
    errorEl.textContent = "";
    if (mode === "login") {
      loginTab.classList.add("active");
      registerTab.classList.remove("active");
      submitBtn.textContent = "Log in";
      passwordInput.setAttribute("autocomplete", "current-password");
    } else {
      registerTab.classList.add("active");
      loginTab.classList.remove("active");
      submitBtn.textContent = "Register";
      passwordInput.setAttribute("autocomplete", "new-password");
    }
  }

  loginTab.addEventListener("click", () => setMode("login"));
  registerTab.addEventListener("click", () => setMode("register"));

  const form = el(
    "form",
    {
      className: "auth-form",
      onsubmit: async (event) => {
        event.preventDefault();
        errorEl.textContent = "";
        const username = usernameInput.value.trim();
        const password = passwordInput.value;
        submitBtn.disabled = true;
        try {
          if (mode === "register") {
            await register(username, password);
            // Registering doesn't itself establish a session; log in
            // immediately afterward so "register" lands the user in the app.
            await login(username, password);
          } else {
            await login(username, password);
          }
          await showProjectsView();
        } catch (err) {
          errorEl.textContent = err.message || "Something went wrong. Please try again.";
          submitBtn.disabled = false;
        }
      },
    },
    [
      el("label", {}, ["Username", usernameInput]),
      el("label", {}, ["Password", passwordInput]),
      submitBtn,
      errorEl,
    ]
  );

  const card = el("div", { className: "auth-card" }, [
    el("h1", {}, ["AI Page Builder"]),
    el("div", { className: "auth-tabs" }, [loginTab, registerTab]),
    form,
  ]);

  mount(el("div", { className: "view view-auth" }, [card]));
  usernameInput.focus();
}

// ---------------------------------------------------------------------------
// Projects list view
// ---------------------------------------------------------------------------

async function showProjectsView() {
  const loading = el("div", { className: "view view-projects" }, [el("p", {}, ["Loading projects..."])]);
  mount(loading);

  try {
    const projects = await listProjects();
    renderProjectsView(projects);
  } catch (err) {
    if (handleSessionExpired(err)) return;
    mount(
      el("div", { className: "view view-projects" }, [
        el("p", { className: "error", role: "alert" }, [
          err.message || "Could not load projects.",
        ]),
        el("button", { className: "btn", onclick: () => showProjectsView() }, ["Retry"]),
      ])
    );
  }
}

function renderProjectsView(projects) {
  const errorEl = el("p", { className: "error", role: "alert" });

  const logoutBtn = el(
    "button",
    {
      className: "btn btn-link",
      onclick: async () => {
        try {
          await logout();
        } catch {
          // Logout failing server-side still returns the user to the auth
          // view locally; there's nothing further to recover.
        }
        renderAuthView();
      },
    },
    ["Log out"]
  );

  const newProjectForm = el("div", { className: "new-project-form hidden" });
  const nameInput = el("input", { type: "text", placeholder: "Project name" });
  const confirmBtn = el("button", { className: "btn btn-primary", type: "button" }, ["Create"]);
  const cancelBtn = el("button", { className: "btn btn-link", type: "button" }, ["Cancel"]);
  const createErrorEl = el("p", { className: "error", role: "alert" });

  function openNewProjectForm() {
    newProjectForm.classList.remove("hidden");
    nameInput.value = "";
    createErrorEl.textContent = "";
    nameInput.focus();
  }

  function closeNewProjectForm() {
    newProjectForm.classList.add("hidden");
  }

  confirmBtn.addEventListener("click", async () => {
    const name = nameInput.value.trim();
    if (!name) {
      createErrorEl.textContent = "Project name is required.";
      return;
    }
    confirmBtn.disabled = true;
    try {
      const project = await createProject(name);
      await openEditor(project.id);
    } catch (err) {
      if (handleSessionExpired(err)) return;
      createErrorEl.textContent = err.message || "Could not create project.";
      confirmBtn.disabled = false;
    }
  });
  cancelBtn.addEventListener("click", closeNewProjectForm);
  newProjectForm.append(nameInput, confirmBtn, cancelBtn, createErrorEl);

  const newProjectBtn = el(
    "button",
    { className: "btn btn-primary", onclick: openNewProjectForm },
    ["+ New project"]
  );

  const header = el("div", { className: "projects-header" }, [
    el("h1", {}, ["Your projects"]),
    el("div", { className: "projects-header-actions" }, [newProjectBtn, logoutBtn]),
  ]);

  const listEl = el("div", { className: "project-list" });

  if (projects.length === 0) {
    listEl.appendChild(
      el("div", { className: "empty-state" }, [
        el("p", {}, ["You don't have any projects yet."]),
        el("button", { className: "btn btn-primary", onclick: openNewProjectForm }, ["Create new"]),
      ])
    );
  } else {
    for (const project of projects) {
      listEl.appendChild(renderProjectCard(project));
    }
  }

  mount(
    el("div", { className: "view view-projects" }, [
      header,
      newProjectForm,
      errorEl,
      listEl,
    ])
  );
}

function renderProjectCard(project) {
  const cardError = el("p", { className: "error", role: "alert" });

  const openBtn = el(
    "button",
    {
      className: "btn",
      onclick: () => openEditor(project.id),
    },
    ["Open"]
  );

  const deleteBtn = el(
    "button",
    {
      className: "btn btn-danger",
      onclick: async () => {
        const confirmed = window.confirm(`Delete "${project.name}"? This cannot be undone.`);
        if (!confirmed) return;
        deleteBtn.disabled = true;
        try {
          await deleteProject(project.id);
          card.remove();
        } catch (err) {
          if (handleSessionExpired(err)) return;
          cardError.textContent = err.message || "Could not delete project.";
          deleteBtn.disabled = false;
        }
      },
    },
    ["Delete"]
  );

  const statusEl = project.everPublished && project.publishedUrl
    ? el("p", { className: "project-status" }, [
        "Published: ",
        el("a", { href: project.publishedUrl, target: "_blank", rel: "noopener" }, [project.publishedUrl]),
      ])
    : el("p", { className: "project-status project-status-unpublished" }, ["Not published yet"]);

  const card = el("div", { className: "project-card" }, [
    el("h2", {}, [project.name]),
    statusEl,
    el("div", { className: "project-card-actions" }, [openBtn, deleteBtn]),
    cardError,
  ]);

  return card;
}

// ---------------------------------------------------------------------------
// Editor view
// ---------------------------------------------------------------------------

async function openEditor(projectId) {
  mount(el("div", { className: "view view-editor" }, [el("p", {}, ["Loading project..."])]));
  try {
    const project = await getProject(projectId);
    renderEditorView(project);
  } catch (err) {
    if (handleSessionExpired(err)) return;
    mount(
      el("div", { className: "view view-editor" }, [
        el("p", { className: "error", role: "alert" }, [err.message || "Could not load project."]),
        el("button", { className: "btn", onclick: () => showProjectsView() }, ["Back to projects"]),
      ])
    );
  }
}

function renderEditorView(initialProject) {
  let project = initialProject;
  let mobileTab = "chat"; // "chat" | "preview"

  const backBtn = el(
    "button",
    { className: "btn btn-link", onclick: () => showProjectsView() },
    ["← Projects"]
  );

  const publishErrorEl = el("p", { className: "error", role: "alert" });
  const publishedUrlEl = el("p", { className: "published-url" });

  function renderPublishedUrl() {
    clear(publishedUrlEl);
    if (project.everPublished && project.publishedUrl) {
      publishedUrlEl.append(
        "Live at: ",
        el("a", { href: project.publishedUrl, target: "_blank", rel: "noopener" }, [project.publishedUrl])
      );
    }
  }
  renderPublishedUrl();

  const publishBtn = el(
    "button",
    {
      className: "btn btn-primary",
      onclick: async () => {
        publishErrorEl.textContent = "";
        publishBtn.disabled = true;
        publishBtn.textContent = "Publishing...";
        try {
          const result = await publishProject(project.id);
          project.everPublished = true;
          project.publishedUrl = result.publishedUrl;
          renderPublishedUrl();
        } catch (err) {
          if (handleSessionExpired(err)) return;
          publishErrorEl.textContent = err.message || "Publish failed.";
        } finally {
          publishBtn.disabled = false;
          publishBtn.textContent = project.everPublished ? "Re-publish" : "Publish";
        }
      },
    },
    [project.everPublished ? "Re-publish" : "Publish"]
  );

  const chatTabBtn = el("button", { className: "mobile-tab-btn active", type: "button" }, ["Chat"]);
  const previewTabBtn = el("button", { className: "mobile-tab-btn", type: "button" }, ["Preview"]);

  const chatPane = el("div", { className: "chat-pane active-pane" });
  const previewPane = el("div", { className: "preview-pane" });

  function setMobileTab(tab) {
    mobileTab = tab;
    chatTabBtn.classList.toggle("active", tab === "chat");
    previewTabBtn.classList.toggle("active", tab === "preview");
    chatPane.classList.toggle("active-pane", tab === "chat");
    previewPane.classList.toggle("active-pane", tab === "preview");
  }
  chatTabBtn.addEventListener("click", () => setMobileTab("chat"));
  previewTabBtn.addEventListener("click", () => setMobileTab("preview"));

  const mobileTabs = el("div", { className: "mobile-tabs" }, [chatTabBtn, previewTabBtn]);

  const header = el("div", { className: "editor-header" }, [
    el("div", { className: "editor-header-left" }, [backBtn, el("h1", {}, [project.name])]),
    el("div", { className: "editor-header-right" }, [publishedUrlEl, publishBtn, publishErrorEl]),
  ]);

  // --- Chat pane ---
  const messagesEl = el("div", { className: "chat-messages" });

  function appendMessageBubble(role, text) {
    const bubble = el("div", { className: `message message-${role}` });
    bubble.textContent = text;
    messagesEl.appendChild(bubble);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return bubble;
  }

  for (const message of project.chatHistory ?? []) {
    appendMessageBubble(message.role, message.content);
  }

  const chatInput = el("textarea", {
    placeholder: "Describe the change you want...",
    rows: "2",
  });
  const sendBtn = el("button", { className: "btn btn-primary", type: "submit" }, ["Send"]);
  const chatErrorEl = el("p", { className: "error", role: "alert" });

  const chatForm = el(
    "form",
    {
      className: "chat-form",
      onsubmit: async (event) => {
        event.preventDefault();
        const message = chatInput.value.trim();
        if (!message) return;

        chatErrorEl.textContent = "";
        chatInput.value = "";
        chatInput.disabled = true;
        sendBtn.disabled = true;

        appendMessageBubble("user", message);
        const assistantBubble = appendMessageBubble("assistant", "");

        try {
          await streamChat(project.id, message, (chunk) => {
            assistantBubble.textContent += chunk;
            messagesEl.scrollTop = messagesEl.scrollHeight;
          });

          // Per the design, the live preview only updates once the full
          // response has arrived, not token-by-token: fetch the persisted
          // project (with its freshly generated HTML) and re-render then.
          project = await getProject(project.id);
          renderPreview(previewIframe, project.html);
        } catch (err) {
          if (handleSessionExpired(err)) return;
          // An error with an HTTP status was a rejected request; one without
          // came from the response stream itself breaking, which the Worker
          // does when the AI produced no usable HTML or the result couldn't
          // be saved -- in both cases the page's previous HTML is kept.
          chatErrorEl.textContent =
            err && err.status
              ? err.message || "Chat failed. Please try again."
              : "That change couldn't be applied, so your page was left as it was. Please try again.";
        } finally {
          chatInput.disabled = false;
          sendBtn.disabled = false;
          chatInput.focus();
        }
      },
    },
    [chatInput, sendBtn]
  );

  chatPane.append(messagesEl, chatForm, chatErrorEl);

  // --- Preview pane ---
  const previewIframe = el("iframe", { className: "preview-iframe", title: "Page preview" });
  previewPane.appendChild(previewIframe);

  mount(
    el("div", { className: "view view-editor" }, [
      header,
      mobileTabs,
      el("div", { className: "editor-body" }, [chatPane, previewPane]),
    ])
  );

  renderPreview(previewIframe, project.html);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

// The session cookie is HttpOnly, so the page can't inspect it directly:
// probe the API instead. A successful project list means the existing
// session is valid, so skip the login screen.
async function boot() {
  try {
    const projects = await listProjects();
    renderProjectsView(projects);
  } catch {
    renderAuthView();
  }
}

boot();
