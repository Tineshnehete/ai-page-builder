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

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------
// Built via DOMParser + importNode rather than innerHTML, so no HTML string
// is ever parsed directly into a live DOM node (every icon here is a fixed,
// developer-authored string, not user data, but this keeps the file's
// "never innerHTML" discipline absolute rather than carving out an
// exception).

const ICON_PATHS = {
  publish:
    '<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
  link:
    '<path d="M9 17H7a5 5 0 010-10h2"/><path d="M15 7h2a5 5 0 010 10h-2"/><line x1="8" y1="12" x2="16" y2="12"/>',
  externalLink:
    '<path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><path d="M15 3h6v6"/><path d="M10 14L21 3"/>',
  trash:
    '<path d="M3 6h18"/><path d="M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>',
  close: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  send:
    '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  logout:
    '<path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
  arrowLeft:
    '<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>',
  page: '<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="9" x2="9" y2="21"/>',
};

const svgParser = new DOMParser();

function icon(name, className = "") {
  const inner = ICON_PATHS[name];
  const doc = svgParser.parseFromString(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon ${className}" aria-hidden="true" focusable="false">${inner}</svg>`,
    "image/svg+xml"
  );
  return document.importNode(doc.documentElement, true);
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
      title: "Log out",
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
    [icon("logout"), "Log out"]
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
    [icon("plus"), "New project"]
  );

  const header = el("div", { className: "projects-header" }, [
    el("div", { className: "projects-header-title" }, [
      el("h1", { className: "app-title" }, ["AI Page Builder"]),
      el("p", { className: "app-subtitle" }, ["Your projects"]),
    ]),
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

// Deterministic hue from the project's id, so each thumbnail gets a stable
// but varied gradient instead of every card looking identical.
function thumbnailHue(seed) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return hash % 360;
}

function renderProjectCard(project) {
  const cardError = el("p", { className: "error", role: "alert" });

  const deleteBtn = el(
    "button",
    {
      className: "icon-btn thumbnail-delete",
      title: "Delete project",
      onclick: async (event) => {
        event.stopPropagation();
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
    [icon("trash")]
  );

  const hue = thumbnailHue(project.id);
  const thumbnail = el(
    "div",
    {
      className: "project-thumbnail",
      style: `background: linear-gradient(135deg, hsl(${hue} 85% 92%), hsl(${(hue + 40) % 360} 85% 86%));`,
      onclick: () => openEditor(project.id),
    },
    [icon("page", "thumbnail-icon"), deleteBtn]
  );

  const isPublished = project.everPublished && project.publishedUrl;
  const statusEl = el("p", { className: `project-status ${isPublished ? "" : "project-status-unpublished"}` }, [
    isPublished ? "Published" : "Not published yet",
  ]);

  const openBtn = el("button", { className: "btn", onclick: () => openEditor(project.id) }, ["Open"]);
  const visitBtn = isPublished
    ? el(
        "a",
        { className: "btn btn-link", href: project.publishedUrl, target: "_blank", rel: "noopener" },
        [icon("externalLink"), "Visit"]
      )
    : null;

  const card = el("div", { className: "project-card" }, [
    thumbnail,
    el("div", { className: "project-card-body" }, [
      el("h2", {}, [project.name]),
      statusEl,
      el("div", { className: "project-card-actions" }, [openBtn, visitBtn].filter(Boolean)),
      cardError,
    ]),
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
    [icon("arrowLeft"), "Projects"]
  );

  const publishErrorEl = el("p", { className: "error", role: "alert" });

  // --- Published-URL popover (replaces an always-visible link in the
  // header: the URL/visit action lives behind a small trigger instead). ---
  const popoverPanel = el("div", { className: "popover hidden" });

  function renderPopoverContent() {
    clear(popoverPanel);
    const closeBtn = el(
      "button",
      { className: "icon-btn popover-close", title: "Close", onclick: () => closePopover() },
      [icon("close")]
    );
    if (project.everPublished && project.publishedUrl) {
      popoverPanel.append(
        closeBtn,
        el("p", { className: "popover-label" }, ["Published at"]),
        el("p", { className: "popover-url" }, [project.publishedUrl]),
        el(
          "a",
          {
            className: "btn btn-primary",
            href: project.publishedUrl,
            target: "_blank",
            rel: "noopener",
          },
          [icon("externalLink"), "Visit site"]
        )
      );
    } else {
      popoverPanel.append(
        closeBtn,
        el("p", { className: "popover-label" }, ["Not published yet"]),
        el("p", { className: "popover-hint" }, ["Publish your page to get a live URL."])
      );
    }
  }

  function onPopoverDocClick(event) {
    if (!popoverPanel.contains(event.target) && event.target !== shareBtn && !shareBtn.contains(event.target)) {
      closePopover();
    }
  }
  function onPopoverDocKey(event) {
    if (event.key === "Escape") closePopover();
  }
  function openPopover() {
    renderPopoverContent();
    popoverPanel.classList.remove("hidden");
    document.addEventListener("click", onPopoverDocClick);
    document.addEventListener("keydown", onPopoverDocKey);
  }
  function closePopover() {
    popoverPanel.classList.add("hidden");
    document.removeEventListener("click", onPopoverDocClick);
    document.removeEventListener("keydown", onPopoverDocKey);
  }

  const shareBtn = el(
    "button",
    {
      className: "icon-btn",
      title: "View published link",
      onclick: () => (popoverPanel.classList.contains("hidden") ? openPopover() : closePopover()),
    },
    [icon("link")]
  );

  const publishBtn = el(
    "button",
    {
      className: "btn btn-primary",
      onclick: async () => {
        publishErrorEl.textContent = "";
        publishBtn.disabled = true;
        clear(publishBtn);
        publishBtn.append(icon("publish"), "Publishing...");
        try {
          const result = await publishProject(project.id);
          project.everPublished = true;
          project.publishedUrl = result.publishedUrl;
          if (!popoverPanel.classList.contains("hidden")) renderPopoverContent();
        } catch (err) {
          if (handleSessionExpired(err)) return;
          publishErrorEl.textContent = err.message || "Publish failed.";
        } finally {
          publishBtn.disabled = false;
          clear(publishBtn);
          publishBtn.append(icon("publish"), project.everPublished ? "Re-publish" : "Publish");
        }
      },
    },
    [icon("publish"), project.everPublished ? "Re-publish" : "Publish"]
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

  const sharePopover = el("div", { className: "share-popover-wrap" }, [shareBtn, popoverPanel]);

  const header = el("div", { className: "editor-header" }, [
    el("div", { className: "editor-header-left" }, [backBtn, el("h1", { className: "editor-title" }, [project.name])]),
    el("div", { className: "editor-header-right" }, [publishErrorEl, sharePopover, publishBtn]),
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

  // Shown in place of the assistant's reply while it's generating. The chat
  // never shows raw model output/HTML -- only this animation while waiting,
  // then the short human-readable summary once the turn completes.
  function appendLoadingBubble() {
    const bubble = el("div", { className: "message message-assistant message-loading" }, [
      el("span", { className: "loading-dot" }),
      el("span", { className: "loading-dot" }),
      el("span", { className: "loading-dot" }),
    ]);
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
  const sendBtn = el("button", { className: "btn btn-primary", type: "submit" }, [icon("send"), "Send"]);
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
        // The chat never displays the model's raw output (it's HTML source,
        // meant only for the preview) -- just an animated "thinking" state
        // while streamChat is in flight. The onChunk callback below exists
        // only to satisfy streamChat's signature; its content is discarded.
        const loadingBubble = appendLoadingBubble();

        try {
          await streamChat(project.id, message, () => {});

          // Per the design, the live preview only updates once the full
          // response has arrived, not token-by-token: fetch the persisted
          // project (with its freshly generated HTML and the model's short
          // summary appended to chatHistory) and re-render then.
          project = await getProject(project.id);
          renderPreview(previewIframe, project.html);
          renderAddressBar();
          const lastMessage = project.chatHistory[project.chatHistory.length - 1];
          loadingBubble.className = "message message-assistant";
          loadingBubble.textContent = lastMessage ? lastMessage.content : "Updated your page.";
        } catch (err) {
          loadingBubble.remove();
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
  // A decorative browser-chrome bar sits above the iframe (traffic-light
  // dots + an address bar showing the published URL, or a placeholder when
  // unpublished) so the preview reads as "a page in a browser", distinct
  // from the rest of the editor UI around it.
  const addressBarText = el("span", { className: "address-bar-text" });
  function renderAddressBar() {
    addressBarText.textContent =
      project.everPublished && project.publishedUrl ? project.publishedUrl : "Not published yet";
  }
  renderAddressBar();

  const browserChrome = el("div", { className: "browser-chrome" }, [
    el("div", { className: "browser-dots" }, [
      el("span", { className: "browser-dot browser-dot-red" }),
      el("span", { className: "browser-dot browser-dot-yellow" }),
      el("span", { className: "browser-dot browser-dot-green" }),
    ]),
    el("div", { className: "address-bar" }, [addressBarText]),
  ]);

  const previewIframe = el("iframe", { className: "preview-iframe", title: "Page preview" });
  previewPane.append(browserChrome, previewIframe);

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
