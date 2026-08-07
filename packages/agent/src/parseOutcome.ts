export type ParsedTask = { title: string; description: string };
export type ParsedOutcome = {
  tasks: ParsedTask[];
  verify?: "pass" | "fail";
  test?: "pass" | "fail";
};

const TASK_LINE = /^TASK\s+(.+?)\s+\|\s*(.*)$/;
const VERIFY_LINE = /^VERIFY\s+(pass|fail)$/i;
const TEST_LINE = /^TEST\s+(pass|fail)$/i;

export function parseOutcome(summary: string): ParsedOutcome {
  const outcome: ParsedOutcome = { tasks: [] };

  for (const raw of summary.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;

    const taskMatch = line.match(TASK_LINE);
    if (taskMatch) {
      outcome.tasks.push({
        title: taskMatch[1]!.trim(),
        description: taskMatch[2]!.trim(),
      });
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
