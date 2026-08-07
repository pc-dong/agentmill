export type Job = {
  id: string;
  boardId: string;
  cardId: string;
  employeeId: string;
  status: string;
  trigger: string;
  payload: string | null;
  workerId: string | null;
  error: string | null;
  createdAt: string;
  claimedAt: string | null;
  finishedAt: string | null;
};

export type Card = {
  id: string;
  boardId: string;
  type: string;
  title: string;
  description: string;
  column: string;
  epicId: string | null;
  reworkCount: number;
  frozen: boolean;
  lockedJobId: string | null;
  lockedAt: string | null;
  artifacts: Array<{ kind: string; href: string; label?: string }>;
  createdAt: string;
  updatedAt: string;
};

export type Employee = {
  id: string;
  boardId: string;
  role: string;
  displayName: string;
  watchColumns: string[];
  adapter: string;
};

export type SessionMessage = {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "system";
  body: string;
  createdAt: string;
};

export type Session = {
  id: string;
  boardId: string;
  cardId: string;
  employeeRole: string;
  status: "open" | "closed";
  createdAt: string;
  updatedAt: string;
};

export type BoardClientOptions = {
  apiBase: string;
  boardId: string;
  workerId: string;
};

export class BoardClient {
  constructor(private readonly opts: BoardClientOptions) {}

  async listClaimableJobs(): Promise<Job[]> {
    return this.getJson<Job[]>(
      `/boards/${this.opts.boardId}/jobs/claimable`,
    );
  }

  async claimJob(jobId: string): Promise<Job | null> {
    const res = await fetch(`${this.opts.apiBase}/jobs/${jobId}/claim`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workerId: this.opts.workerId }),
    });
    if (res.status === 409) return null;
    if (!res.ok) {
      throw new Error(`claimJob failed: ${res.status}`);
    }
    return (await res.json()) as Job;
  }

  async completeJob(
    jobId: string,
    body: {
      summary: string;
      artifacts: Array<{ kind: string; href: string; label: string }>;
    },
  ): Promise<void> {
    await this.postJson(`/jobs/${jobId}/complete`, body);
  }

  async failJob(jobId: string, message: string): Promise<void> {
    await this.postJson(`/jobs/${jobId}/fail`, { message });
  }

  async getBoard(): Promise<{ workspacePath: string }> {
    const board = await this.getJson<{ workspacePath: string }>(
      `/boards/${this.opts.boardId}`,
    );
    return { workspacePath: board.workspacePath };
  }

  async listCards(): Promise<Card[]> {
    return this.getJson<Card[]>(`/boards/${this.opts.boardId}/cards`);
  }

  async getCard(cardId: string): Promise<Card> {
    const cards = await this.listCards();
    const card = cards.find((c) => c.id === cardId);
    if (!card) {
      throw new Error(`Card not found: ${cardId}`);
    }
    return card;
  }

  async createCard(input: {
    type: "epic" | "requirement" | "task";
    title: string;
    description?: string;
    column: string;
    epicId?: string | null;
  }): Promise<Card> {
    return this.postJson<Card>(`/boards/${this.opts.boardId}/cards`, {
      description: "",
      epicId: null,
      ...input,
    });
  }

  async moveCard(
    cardId: string,
    to: string,
    actor: "bot" | "human",
  ): Promise<Card> {
    const res = await fetch(`${this.opts.apiBase}/cards/${cardId}/move`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ to, actor }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `move failed: ${res.status}`);
    }
    return (await res.json()) as Card;
  }

  async postTestResult(cardId: string, passed: boolean): Promise<Card> {
    return this.postJson<Card>(`/cards/${cardId}/test-result`, { passed });
  }

  async postComment(
    cardId: string,
    author: string,
    body: string,
  ): Promise<void> {
    await this.postJson(`/cards/${cardId}/comments`, { author, body });
  }

  async baSettle(
    cardId: string,
    body: {
      mode: "create" | "link";
      epicKey: string;
      epicTitle: string;
      epicSlug: string;
      artifacts: Array<{ kind: string; href: string; label: string }>;
      warning?: string;
    },
  ): Promise<unknown> {
    return this.postJson(`/cards/${cardId}/ba-settle`, body);
  }

  async getEmployee(employeeId: string): Promise<Employee> {
    const employees = await this.getJson<Employee[]>(
      `/boards/${this.opts.boardId}/employees`,
    );
    const employee = employees.find((e) => e.id === employeeId);
    if (!employee) {
      throw new Error(`Employee not found: ${employeeId}`);
    }
    return employee;
  }

  async createPollJobs(): Promise<{ created: number }> {
    return this.postJson(`/boards/${this.opts.boardId}/poll-jobs`, {});
  }

  async listSessionMessages(sessionId: string): Promise<SessionMessage[]> {
    return this.getJson<SessionMessage[]>(`/sessions/${sessionId}/messages`);
  }

  async getSession(sessionId: string): Promise<Session> {
    return this.getJson<Session>(`/sessions/${sessionId}`);
  }

  private async getJson<T>(path: string): Promise<T> {
    const res = await fetch(`${this.opts.apiBase}${path}`);
    if (!res.ok) {
      throw new Error(`GET ${path} failed: ${res.status}`);
    }
    return (await res.json()) as T;
  }

  private async postJson<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.opts.apiBase}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`POST ${path} failed: ${res.status}`);
    }
    return (await res.json()) as T;
  }
}
