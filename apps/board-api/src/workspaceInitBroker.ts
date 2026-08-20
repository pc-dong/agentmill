import type { WorkspaceInitResult } from "./workspaceInit.js";

/**
 * Loopback client for the workspace-init broker (scripts/workspace-init-broker.mjs).
 *
 * The API runs least-privileged. When a newly registered board workspace is
 * outside the API's writable scope, the route retries the copy through this
 * broker — the "dynamic inclusion" step: the new workspace becomes writable
 * immediately without restarting the API or escalating its permissions.
 */

const BROKER_TIMEOUT_MS = 20_000;

/** Configured broker base URL (e.g. http://127.0.0.1:8790), or null. */
export function brokerBaseUrl(): string | null {
  const url = (
    process.env.AM_WORKSPACE_INIT_BROKER ??
    process.env.AIW_WORKSPACE_INIT_BROKER ??
    ""
  ).trim();
  return url || null;
}

export type BrokerInitOutcome =
  | (Extract<WorkspaceInitResult, { ok: true }> & { via: "broker" })
  | { ok: false; error: string; status: 403; needsAuthorization: true };

/**
 * Ask the broker to copy the template into workspacePath (never overwriting).
 * Returns the broker's success payload, or a 403 needsAuthorization outcome
 * when the broker is unavailable or refuses.
 */
export async function tryBrokerInit(
  workspacePath: string,
  templateRoot: string,
): Promise<BrokerInitOutcome> {
  const base = brokerBaseUrl();
  if (!base) {
    return {
      ok: false,
      error: "workspace 目录不可写且未配置初始化代理（AM_WORKSPACE_INIT_BROKER）",
      status: 403,
      needsAuthorization: true,
    };
  }
  try {
    const res = await fetch(`${base.replace(/\/+$/, "")}/copy`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspacePath, templateRoot }),
      signal: AbortSignal.timeout(BROKER_TIMEOUT_MS),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return {
        ok: false,
        error: `初始化代理拒绝：${String(body.error ?? res.statusText)}`,
        status: 403,
        needsAuthorization: true,
      };
    }
    if (
      typeof body.copied !== "number" ||
      typeof body.skipped !== "number" ||
      typeof body.totalFiles !== "number"
    ) {
      return {
        ok: false,
        error: "初始化代理返回了无法识别的结果",
        status: 403,
        needsAuthorization: true,
      };
    }
    return {
      ok: true,
      via: "broker",
      templatePath: String(body.templatePath ?? templateRoot),
      totalFiles: body.totalFiles,
      copied: body.copied,
      skipped: body.skipped,
      copiedSample: Array.isArray(body.copiedSample)
        ? (body.copiedSample as string[])
        : [],
    };
  } catch (e) {
    return {
      ok: false,
      error: `初始化代理不可用：${e instanceof Error ? e.message : String(e)}（可运行 pnpm run init-broker 启动）`,
      status: 403,
      needsAuthorization: true,
    };
  }
}
