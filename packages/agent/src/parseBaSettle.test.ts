import { describe, expect, it } from "vitest";
import { epicDirRel, parseBaSettle, prdRel } from "./parseBaSettle.js";

const sample = `
EPIC_MODE create
EPIC_ID E-DEMO-001
EPIC_SLUG login
EPIC_TITLE Login theme
PRD_ID P-001-01
PRD_SLUG oauth
PRD_TITLE OAuth login
ARTIFACT file docs/epics/E-DEMO-001-login/EPIC.md Epic
ARTIFACT file docs/epics/E-DEMO-001-login/shared-context.md Shared
ARTIFACT file docs/epics/E-DEMO-001-login/prds/P-001-01-oauth.md PRD
`;

describe("parseBaSettle", () => {
  it("parses create protocol", () => {
    const r = parseBaSettle(sample);
    expect("error" in r).toBe(false);
    if ("error" in r) return;
    expect(r.mode).toBe("create");
    expect(r.epicId).toBe("E-DEMO-001");
    expect(r.epicSlug).toBe("login");
    expect(r.epicTitle).toBe("Login theme");
    expect(r.prdId).toBe("P-001-01");
    expect(r.prdSlug).toBe("oauth");
    expect(r.prdTitle).toBe("OAuth login");
    expect(r.artifacts).toHaveLength(3);
  });

  it("rejects missing EPIC_MODE", () => {
    const r = parseBaSettle("PRD_ID P-001-01");
    expect("error" in r).toBe(true);
  });

  it("parses link protocol with PRD artifact", () => {
    const r = parseBaSettle(`
EPIC_MODE link
EPIC_ID E-DEMO-001
EPIC_SLUG login
EPIC_TITLE Login theme
PRD_ID P-001-02
PRD_SLUG sso
PRD_TITLE SSO login
ARTIFACT file docs/epics/E-DEMO-001-login/prds/P-001-02-sso.md PRD
`);
    expect("error" in r).toBe(false);
    if ("error" in r) return;
    expect(r.mode).toBe("link");
    expect(r.artifacts).toHaveLength(1);
  });

  it("rejects create without file artifacts", () => {
    const r = parseBaSettle(`
EPIC_MODE create
EPIC_ID E-DEMO-001
EPIC_SLUG login
EPIC_TITLE Login theme
PRD_ID P-001-01
PRD_SLUG oauth
PRD_TITLE OAuth login
`);
    expect("error" in r).toBe(true);
  });

  it("rejects link without PRD path artifact", () => {
    const r = parseBaSettle(`
EPIC_MODE link
EPIC_ID E-DEMO-001
EPIC_SLUG login
EPIC_TITLE Login theme
PRD_ID P-001-01
PRD_SLUG oauth
PRD_TITLE OAuth login
ARTIFACT file docs/epics/E-DEMO-001-login/EPIC.md Epic
`);
    expect("error" in r).toBe(true);
  });

  it("epicDirRel and prdRel build expected paths", () => {
    const r = parseBaSettle(sample);
    expect("error" in r).toBe(false);
    if ("error" in r) return;
    expect(epicDirRel(r)).toBe("docs/epics/E-DEMO-001-login");
    expect(prdRel(r)).toBe("docs/epics/E-DEMO-001-login/prds/P-001-01-oauth.md");
  });
});
