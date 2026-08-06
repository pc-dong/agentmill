const base = "/api";

async function json<T>(res: Response | Promise<Response>): Promise<T> {
  const response = await res;
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? response.statusText);
  }
  return response.json() as Promise<T>;
}

export type Card = {
  id: string;
  boardId: string;
  type: "epic" | "requirement" | "task";
  title: string;
  description: string;
  column: string;
  epicId: string | null;
  reworkCount: number;
  frozen: boolean;
  artifacts: Array<{ kind: string; href: string; label?: string }>;
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
    },
  ) =>
    json<Card>(
      fetch(`${base}/boards/${boardId}/cards`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    ),
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
  addComment: (cardId: string, author: string, body: string) =>
    json(
      fetch(`${base}/cards/${cardId}/comments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ author, body }),
      }),
    ),
};
