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
});
