const base = "/api";

async function json<T>(res: Response | Promise<Response>): Promise<T> {
  const response = await res;
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? response.statusText);
  }
  return response.json() as Promise<T>;
}

export type ArtifactHint = {
  kind: "file" | "url" | "pr";
  href: string;
  label?: string;
};

export type RequirementStatus = "open" | "in_progress" | "done";

export type Card = {
  id: string;
  boardId: string;
  type: "epic" | "requirement" | "design" | "task";
  title: string;
  description: string;
  column: string;
  epicId: string | null;
  designId?: string | null;
  reworkCount: number;
  frozen: boolean;
  artifacts: ArtifactHint[];
  /** Set when a claimed job locks the card (bot processing). */
  lockedJobId?: string | null;
  lockedAt?: string | null;
  /** Employee display name for the locking claimed job, if any. */
  processingBy?: string | null;
  /** Claimed locking job details for progress UI. */
  activeJob?: {
    id: string;
    status: string;
    trigger: string;
    role: string;
    displayName: string;
    claimedAt: string | null;
    progress: string | null;
    progressAt: string | null;
  } | null;
  /** Requirement coarse status; null/undefined for other types. */
  status?: RequirementStatus | null;
  /** Populated for design cards. */
  requirementIds?: string[];
  /** Design card: last successful split verify; null when dirty / never verified. */
  splitVerifiedAt?: string | null;
};

export type SessionMessage = {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "system";
  body: string;
  createdAt: string;
};

export const api = {
  createBoard: (name: string, workspacePath: string) =>
    json<{ id: string; name: string; workspacePath: string }>(
      fetch(`${base}/boards`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, workspacePath }),
      }),
    ),
  getBoard: (id: string) => json(fetch(`${base}/boards/${id}`)),
  listCards: (boardId: string) =>
    json<Card[]>(fetch(`${base}/boards/${boardId}/cards`)),
  createCard: (
    boardId: string,
    body: {
      type: Card["type"];
      title: string;
      description?: string;
      column: string;
      epicId?: string | null;
      status?: RequirementStatus;
      requirementIds?: string[];
      frozen?: boolean;
    },
  ) =>
    json<Card>(
      fetch(`${base}/boards/${boardId}/cards`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    ),
  createDesignRound: (
    boardId: string,
    body: {
      epicId: string;
      title?: string;
      description?: string;
      requirementIds: string[];
    },
  ) =>
    json<Card>(
      fetch(`${base}/boards/${boardId}/design-rounds`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    ),
  getDesignLinks: (cardId: string) =>
    json<{ requirementIds: string[]; designIds: string[] }>(
      fetch(`${base}/cards/${cardId}/design-links`),
    ),
  updateCard: (
    cardId: string,
    body: {
      title?: string;
      description?: string;
      epicId?: string | null;
      status?: RequirementStatus;
    },
  ) =>
    json<Card>(
      fetch(`${base}/cards/${cardId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    ),
  deleteCard: (cardId: string, opts?: { confirmDelete?: boolean }) =>
    json<{ ok: true; id: string }>(
      fetch(
        `${base}/cards/${cardId}${
          opts?.confirmDelete ? "?confirmDelete=true" : ""
        }`,
        { method: "DELETE" },
      ),
    ),
  splitSettle: (cardId: string, body: { ops: unknown[] }) =>
    json<{
      applied: unknown[];
      skipped: unknown[];
      design: Card;
    }>(
      fetch(`${base}/cards/${cardId}/split-settle`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    ),
  listEmployees: (boardId: string) =>
    json<
      Array<{
        id: string;
        role: string;
        displayName: string;
        watchColumns: string[];
      }>
    >(fetch(`${base}/boards/${boardId}/employees`)),
  moveCard: (
    cardId: string,
    body: { to: string; actor: "human" | "bot"; humanApproved?: boolean },
  ) =>
    json<Card>(
      fetch(`${base}/cards/${cardId}/move`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    ),
  humanDecision: (
    cardId: string,
    decision: "return_dev" | "force_accept" | "close_done",
  ) =>
    json<Card>(
      fetch(`${base}/cards/${cardId}/human-decision`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision }),
      }),
    ),
  listComments: (cardId: string) =>
    json<Array<{ id: string; author: string; body: string; createdAt: string }>>(
      fetch(`${base}/cards/${cardId}/comments`),
    ),
  addComment: (
    cardId: string,
    author: string,
    body: string,
    opts?: { includeCommentHistory?: boolean },
  ) =>
    json(
      fetch(`${base}/cards/${cardId}/comments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          author,
          body,
          includeCommentHistory: opts?.includeCommentHistory,
        }),
      }),
    ),
  createSession: (boardId: string, cardId: string, employeeRole = "design") =>
    json<{ id: string; resumed?: boolean }>(
      fetch(`${base}/boards/${boardId}/cards/${cardId}/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ employeeRole }),
      }),
    ),
  getLatestSession: (boardId: string, cardId: string, role?: string) =>
    fetch(
      `${base}/boards/${boardId}/cards/${cardId}/sessions/latest${
        role ? `?role=${encodeURIComponent(role)}` : ""
      }`,
    ).then(async (res) => {
      if (res.status === 404) return null;
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(
          (err as { error?: string }).error ?? res.statusText,
        );
      }
      return res.json() as Promise<{
        session: {
          id: string;
          status: "open" | "closed";
          employeeRole: string;
        };
        messages: SessionMessage[];
      }>;
    }),
  listSessionMessages: (sessionId: string) =>
    json<SessionMessage[]>(fetch(`${base}/sessions/${sessionId}/messages`)),
  editLastUserMessage: (sessionId: string, body: string) =>
    json<{ messages: SessionMessage[] }>(
      fetch(`${base}/sessions/${sessionId}/edit-last-user`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body }),
      }),
    ),
  closeSession: (sessionId: string) =>
    json(fetch(`${base}/sessions/${sessionId}/close`, { method: "POST" })),
  reopenSession: (sessionId: string) =>
    json<{ id: string; status: "open" | "closed" }>(
      fetch(`${base}/sessions/${sessionId}/reopen`, { method: "POST" }),
    ),
  settleSession: (
    sessionId: string,
    body: { artifacts?: ArtifactHint[]; comment?: string },
  ) =>
    json<{ session: unknown; card: Card }>(
      fetch(`${base}/sessions/${sessionId}/settle`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    ),
  createBaJob: (
    cardId: string,
    body: { kind: "settle" | "deep_dive"; summary: string },
  ) =>
    json<{ job: { id: string } }>(
      fetch(`${base}/cards/${cardId}/ba-jobs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    ),
  createDesignJob: (
    cardId: string,
    body: { kind: "deep_dive" | "split" | "verify"; summary?: string },
  ) =>
    json<{ job: { id: string } }>(
      fetch(`${base}/cards/${cardId}/design-jobs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    ),
  getWorkspaceFile: (boardId: string, filePath: string) =>
    json<{ path: string; content: string; language: string }>(
      fetch(
        `${base}/boards/${boardId}/workspace-file?path=${encodeURIComponent(filePath)}`,
      ),
    ),
  /** URL for opening a workspace file (e.g. HTML) in a new browser tab. */
  workspaceRawUrl: (boardId: string, filePath: string) => {
    const encoded = filePath
      .replace(/\\/g, "/")
      .split("/")
      .filter(Boolean)
      .map(encodeURIComponent)
      .join("/");
    return `${base}/boards/${boardId}/workspace-raw/${encoded}`;
  },
  listWorkspaceTree: (boardId: string, root: string, depth = 2) =>
    json<{ root: string; files: Array<{ path: string; name: string }> }>(
      fetch(
        `${base}/boards/${boardId}/workspace-tree?root=${encodeURIComponent(root)}&depth=${depth}`,
      ),
    ),
  listWorkspaceSkills: (boardId: string) =>
    json<{
      skills: Array<{
        name: string;
        description: string;
        path: string;
        kind: "skill" | "command";
        source: string;
      }>;
    }>(fetch(`${base}/boards/${boardId}/workspace-skills`)),
};
