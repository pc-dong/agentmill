---
name: executing-plans
description: Use when you have a written implementation plan to execute in a separate session with review checkpoints
---

# Executing Plans

## Overview

Load plan, review critically, execute all tasks, report when complete.

**Announce at start:** "I'm using the executing-plans skill to implement this plan."

**Note:** Tell your human partner that Superpowers works much better with access to subagents. The quality of its work will be significantly higher if run on a platform with subagent support (Claude Code, Codex CLI, Codex App, and Copilot CLI all qualify; see the per-platform tool refs in `../using-superpowers/references/`). If subagents are available, use superpowers:subagent-driven-development instead of this skill.

## The Process

### Step 1: Load and Review Plan
1. Read plan file
2. Review critically - identify any questions or concerns about the plan
3. If concerns: Raise them with your human partner before starting
4. If no concerns: Create todos for the plan items and proceed

### Step 2: Execute Tasks

For each task:
1. Mark Cursor todo as `in_progress`
2. Follow each step exactly (plan has bite-sized steps)
3. Run verifications as specified
4. Mark Cursor todo as `completed`
5. **REQUIRED — sync plan file checkboxes:** In the same turn as finishing a step (or at latest when finishing the task), edit the plan markdown and flip that step from `- [ ]` to `- [x]`. Do **not** rely only on Cursor todos / chat memory — the plan file is the durable progress record reviewers and later sessions read.

**Plan checkbox gate (before claiming a task or the whole plan done):**
1. `rg -n '^- \[ \]' docs/superpowers/plans/<this-plan>.md` (or equivalent)
2. Every intentionally finished Step must be `- [x]`
3. Leave `- [ ]` only for explicitly skipped / blocked / deferred steps (and say so in the handoff)
4. If any finished Step is still unchecked → fix the plan file **before** saying the task is complete

### Step 3: Complete Development

After all tasks complete and verified:
- Re-run the plan checkbox gate on the full plan (open Steps must be intentional leftovers only)
- Announce: "I'm using the finishing-a-development-branch skill to complete this work."
- **REQUIRED SUB-SKILL:** Use superpowers:finishing-a-development-branch
- Follow that skill to verify tests, present options, execute choice

## When to Stop and Ask for Help

**STOP executing immediately when:**
- Hit a blocker (missing dependency, test fails, instruction unclear)
- Plan has critical gaps preventing starting
- You don't understand an instruction
- Verification fails repeatedly

**Ask for clarification rather than guessing.**

## When to Revisit Earlier Steps

**Return to Review (Step 1) when:**
- Partner updates the plan based on your feedback
- Fundamental approach needs rethinking

**Don't force through blockers** - stop and ask.

## Remember
- Review plan critically first
- Follow plan steps exactly
- Don't skip verifications
- **Always flip plan `- [ ]` → `- [x]` when a Step finishes** (file edit, not just todos)
- Reference skills when plan says to
- Stop when blocked, don't guess
- Never start implementation on main/master branch without explicit user consent

## Integration

**Required workflow skills:**
- **superpowers:using-git-worktrees** - Ensures isolated workspace (creates one or verifies existing)
- **superpowers:writing-plans** - Creates the plan this skill executes
- **superpowers:finishing-a-development-branch** - Complete development after all tasks
