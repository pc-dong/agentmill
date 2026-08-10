export type ParsedTask = {
  title: string;
  description: string;
  planPath?: string;
};
export type ParsedOutcome = {
  tasks: ParsedTask[];
  verify?: "pass" | "fail";
  test?: "pass" | "fail";
};

const TASK_LINE = /^TASK\s+(.+)$/i;
const VERIFY_LINE = /^VERIFY\s+(pass|fail)$/i;
const TEST_LINE = /^TEST\s+(pass|fail)$/i;

export function parseOutcome(summary: string): ParsedOutcome {
  const outcome: ParsedOutcome = { tasks: [] };

  for (const raw of summary.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;

    const taskMatch = line.match(TASK_LINE);
    if (taskMatch) {
      const rest = taskMatch[1]!.trim();
      const parts = rest.split("|").map((p) => p.trim());
      const title = parts[0] ?? "";
      if (!title) continue;
      let description = "";
      let planPath: string | undefined;
      for (let i = 1; i < parts.length; i++) {
        const p = parts[i]!;
        const plan = p.match(/^plan:(.+)$/i);
        if (plan) {
          planPath = plan[1]!.trim();
        } else if (!description) {
          description = p;
        } else {
          description = `${description} | ${p}`;
        }
      }
      outcome.tasks.push({ title, description, planPath });
      continue;
    }

    const verifyMatch = line.match(VERIFY_LINE);
    if (verifyMatch) {
      outcome.verify = verifyMatch[1]!.toLowerCase() as "pass" | "fail";
      continue;
    }

    const testMatch = line.match(TEST_LINE);
    if (testMatch) {
      outcome.test = testMatch[1]!.toLowerCase() as "pass" | "fail";
    }
  }

  return outcome;
}
