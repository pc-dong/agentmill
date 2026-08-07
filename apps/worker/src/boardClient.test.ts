import { afterEach, describe, expect, it, vi } from "vitest";
import { BoardClient } from "./boardClient.js";

const API = "http://127.0.0.1:8787";
const BOARD_ID = "board-1";
const WORKER_ID = "worker-1";

function client() {
  return new BoardClient({ apiBase: API, boardId: BOARD_ID, workerId: WORKER_ID });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("BoardClient", () => {
  it("listClaimableJobs GETs /boards/:boardId/jobs/claimable", async () => {
    const jobs = [{ id: "j1", status: "open" }];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        expect(url).toBe(`${API}/boards/${BOARD_ID}/jobs/claimable`);
        return new Response(JSON.stringify(jobs), { status: 200 });
      }),
    );

    await expect(client().listClaimableJobs()).resolves.toEqual(jobs);
  });

  it("claimJob POSTs workerId and returns job or null on 409", async () => {
    const job = { id: "j1", status: "claimed", workerId: WORKER_ID };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(job), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response("{}", { status: 409 }));
    vi.stubGlobal("fetch", fetchMock);

    const c = client();
    await expect(c.claimJob("j1")).resolves.toEqual(job);
    expect(fetchMock).toHaveBeenCalledWith(`${API}/jobs/j1/claim`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workerId: WORKER_ID }),
    });
    await expect(c.claimJob("j1")).resolves.toBeNull();
  });

  it("completeJob POSTs summary and artifacts", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe(`${API}/jobs/j1/complete`);
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({
        summary: "done",
        artifacts: [{ kind: "file", href: "a.md", label: "A" }],
      });
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await client().completeJob("j1", {
      summary: "done",
      artifacts: [{ kind: "file", href: "a.md", label: "A" }],
    });
  });

  it("failJob POSTs message", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe(`${API}/jobs/j1/fail`);
      expect(JSON.parse(String(init?.body))).toEqual({ message: "boom" });
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await client().failJob("j1", "boom");
  });

  it("getBoard returns workspacePath", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        expect(url).toBe(`${API}/boards/${BOARD_ID}`);
        return new Response(
          JSON.stringify({
            id: BOARD_ID,
            name: "Demo",
            workspacePath: "/tmp/ws",
          }),
          { status: 200 },
        );
      }),
    );

    await expect(client().getBoard()).resolves.toEqual({
      workspacePath: "/tmp/ws",
    });
  });

  it("getCard filters from list cards (no single-card route)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        expect(url).toBe(`${API}/boards/${BOARD_ID}/cards`);
        return new Response(
          JSON.stringify([
            { id: "c1", title: "One" },
            { id: "c2", title: "Two" },
          ]),
          { status: 200 },
        );
      }),
    );

    await expect(client().getCard("c2")).resolves.toMatchObject({
      id: "c2",
      title: "Two",
    });
  });

  it("getCard throws when card missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify([]), { status: 200 })),
    );

    await expect(client().getCard("missing")).rejects.toThrow(/not found/i);
  });

  it("getEmployee filters from list employees", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        expect(url).toBe(`${API}/boards/${BOARD_ID}/employees`);
        return new Response(
          JSON.stringify([
            { id: "e1", role: "design", displayName: "Design Bot" },
            { id: "e2", role: "dev", displayName: "Dev Bot" },
          ]),
          { status: 200 },
        );
      }),
    );

    await expect(client().getEmployee("e2")).resolves.toMatchObject({
      id: "e2",
      role: "dev",
    });
  });

  it("listSessionMessages GETs /sessions/:sessionId/messages", async () => {
    const messages = [
      { id: "m1", sessionId: "s1", role: "user", body: "hi", createdAt: "t" },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        expect(url).toBe(`${API}/sessions/s1/messages`);
        return new Response(JSON.stringify(messages), { status: 200 });
      }),
    );

    await expect(client().listSessionMessages("s1")).resolves.toEqual(messages);
  });

  it("getSession GETs /sessions/:sessionId", async () => {
    const session = {
      id: "s1",
      boardId: BOARD_ID,
      cardId: "c1",
      employeeRole: "ba",
      status: "open",
      createdAt: "t",
      updatedAt: "t",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        expect(url).toBe(`${API}/sessions/s1`);
        return new Response(JSON.stringify(session), { status: 200 });
      }),
    );

    await expect(client().getSession("s1")).resolves.toEqual(session);
  });

  it("createPollJobs POSTs poll-jobs endpoint", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        expect(url).toBe(`${API}/boards/${BOARD_ID}/poll-jobs`);
        expect(init?.method).toBe("POST");
        return new Response(JSON.stringify({ created: 2 }), { status: 200 });
      }),
    );

    await expect(client().createPollJobs()).resolves.toEqual({ created: 2 });
  });

  it("listCards GETs /boards/:boardId/cards", async () => {
    const cards = [{ id: "c1", title: "One" }];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        expect(url).toBe(`${API}/boards/${BOARD_ID}/cards`);
        return new Response(JSON.stringify(cards), { status: 200 });
      }),
    );

    await expect(client().listCards()).resolves.toEqual(cards);
  });

  it("createCard POSTs card payload", async () => {
    const created = { id: "c-new", type: "task", column: "dev" };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        expect(url).toBe(`${API}/boards/${BOARD_ID}/cards`);
        expect(JSON.parse(String(init?.body))).toEqual({
          type: "task",
          title: "T",
          description: "d",
          column: "dev",
          epicId: "epic1",
        });
        return new Response(JSON.stringify(created), { status: 201 });
      }),
    );

    await expect(
      client().createCard({
        type: "task",
        title: "T",
        description: "d",
        column: "dev",
        epicId: "epic1",
      }),
    ).resolves.toEqual(created);
  });

  it("moveCard POSTs to and actor", async () => {
    const updated = { id: "c1", column: "verify" };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        expect(url).toBe(`${API}/cards/c1/move`);
        expect(JSON.parse(String(init?.body))).toEqual({
          to: "verify",
          actor: "bot",
        });
        return new Response(JSON.stringify(updated), { status: 200 });
      }),
    );

    await expect(client().moveCard("c1", "verify", "bot")).resolves.toEqual(
      updated,
    );
  });

  it("moveCard throws on gate failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: "requires human approval" }), {
          status: 400,
        }),
      ),
    );

    await expect(client().moveCard("c1", "split", "bot")).rejects.toThrow(
      /human approval/i,
    );
  });

  it("postTestResult POSTs passed flag", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        expect(url).toBe(`${API}/cards/c1/test-result`);
        expect(JSON.parse(String(init?.body))).toEqual({ passed: true });
        return new Response(JSON.stringify({ id: "c1" }), { status: 200 });
      }),
    );

    await client().postTestResult("c1", true);
  });

  it("postComment POSTs author and body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        expect(url).toBe(`${API}/cards/c1/comments`);
        expect(JSON.parse(String(init?.body))).toEqual({
          author: "bot",
          body: "hello",
        });
        return new Response(JSON.stringify({ id: "cm1" }), { status: 201 });
      }),
    );

    await client().postComment("c1", "bot", "hello");
  });

  it("baSettle POSTs settle body to /cards/:id/ba-settle", async () => {
    const body = {
      mode: "create" as const,
      epicKey: "E-DEMO-001",
      epicTitle: "Login",
      epicSlug: "login",
      artifacts: [{ kind: "file", href: "docs/epics/x/EPIC.md", label: "Epic" }],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        expect(url).toBe(`${API}/cards/c1/ba-settle`);
        expect(JSON.parse(String(init?.body))).toEqual(body);
        return new Response(JSON.stringify({ mode: "create" }), { status: 200 });
      }),
    );

    await expect(client().baSettle("c1", body)).resolves.toEqual({
      mode: "create",
    });
  });
});
