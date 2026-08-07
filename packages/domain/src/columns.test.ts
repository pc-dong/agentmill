import { describe, expect, it } from "vitest";
import { COLUMN_ORDER, isColumnAllowedForType } from "./columns.js";

describe("COLUMN_ORDER", () => {
  it("matches the eight delivery columns", () => {
    expect(COLUMN_ORDER).toEqual([
      "requirements",
      "design",
      "split",
      "verify",
      "dev",
      "test",
      "accept",
      "done",
    ]);
  });
});

describe("isColumnAllowedForType", () => {
  it("keeps requirements in requirements column only", () => {
    expect(isColumnAllowedForType("requirement", "requirements")).toBe(true);
    expect(isColumnAllowedForType("requirement", "design")).toBe(false);
    expect(isColumnAllowedForType("requirement", "dev")).toBe(false);
  });

  it("allows epic in requirements plus design/split/verify", () => {
    expect(isColumnAllowedForType("epic", "requirements")).toBe(true);
    expect(isColumnAllowedForType("epic", "design")).toBe(true);
    expect(isColumnAllowedForType("epic", "split")).toBe(true);
    expect(isColumnAllowedForType("epic", "verify")).toBe(true);
    expect(isColumnAllowedForType("epic", "dev")).toBe(false);
  });

  it("keeps task in dev/test/accept/done only", () => {
    expect(isColumnAllowedForType("task", "dev")).toBe(true);
    expect(isColumnAllowedForType("task", "test")).toBe(true);
    expect(isColumnAllowedForType("task", "accept")).toBe(true);
    expect(isColumnAllowedForType("task", "done")).toBe(true);
    expect(isColumnAllowedForType("task", "design")).toBe(false);
  });
});
