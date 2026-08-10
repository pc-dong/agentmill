import { describe, expect, it } from "vitest";
import { COLUMN_ORDER, isColumnAllowedForType } from "./columns.js";

describe("COLUMN_ORDER", () => {
  it("lists delivery columns without split/verify", () => {
    expect(COLUMN_ORDER).toEqual([
      "requirements",
      "design",
      "dev",
      "test",
      "accept",
      "done",
    ]);
  });
});

describe("isColumnAllowedForType", () => {
  it("keeps requirement in requirements only", () => {
    expect(isColumnAllowedForType("requirement", "requirements")).toBe(true);
    expect(isColumnAllowedForType("requirement", "design")).toBe(false);
  });

  it("keeps epic in requirements only", () => {
    expect(isColumnAllowedForType("epic", "requirements")).toBe(true);
    expect(isColumnAllowedForType("epic", "design")).toBe(false);
    expect(isColumnAllowedForType("epic", "done")).toBe(false);
  });

  it("allows design cards in design and done", () => {
    expect(isColumnAllowedForType("design", "design")).toBe(true);
    expect(isColumnAllowedForType("design", "done")).toBe(true);
    expect(isColumnAllowedForType("design", "split")).toBe(false);
    expect(isColumnAllowedForType("design", "verify")).toBe(false);
    expect(isColumnAllowedForType("design", "dev")).toBe(false);
  });

  it("allows task in delivery columns", () => {
    expect(isColumnAllowedForType("task", "dev")).toBe(true);
    expect(isColumnAllowedForType("task", "done")).toBe(true);
    expect(isColumnAllowedForType("task", "design")).toBe(false);
  });
});
