---
description: Create an execution plan for a feature or system change
allowed-tools: Bash, Read, Edit, Write, Grep, Glob
---

# Research Repo Execution Plans

> Create plans in `plans/<timestamp>-<plan-name>.md`
> Use `<timestamp>` in `YYYYMMDD-HHmm` format (e.g., `20260325-1045-card-type-expansion.md`)

An execution plan ("ExecPlan") is a design document a coding agent can follow to deliver a working feature or system change. The reader has only the working tree and this plan — no memory of prior work.

## Process

1. **Discovery**: Map the relevant code, name the scope, enumerate unknowns. Capture Assumptions and Open Questions.
2. **Clarification**: Ask focused questions grouped by plan section.
3. **Draft**: Complete the ExecPlan skeleton end-to-end.
4. **Resolve**: As answers arrive, update the plan — move items from Open Questions to Decision Log with rationale.
5. **Approval Gate**: Present the plan for approval. Do not implement until approved.
6. **Implementation**: Implement per the plan, update Progress with timestamps, validate via tests.
7. **Closeout**: Write Outcomes & Retrospective. Move plan to `plans/done/`.

## Requirements

- Every ExecPlan must be fully self-contained — all knowledge needed for a novice to succeed
- Every ExecPlan is a living document — revise as progress is made and discoveries occur
- Every ExecPlan must produce demonstrably working behavior, not just code changes
- Reference CLAUDE.md conventions for this repository

## Research Repo Tech Stack

| Project | Stack |
|---------|-------|
| remote-mcp-server | TypeScript, Hono, MCP SDK, Postgres/pgvector, OpenAI embeddings, Anthropic API |
| study-notifier | Electron, React, TypeScript, Tailwind, Vite |

## ExecPlan Skeleton

```markdown
# <Short, action-oriented description>

This ExecPlan is a living document. Progress, Surprises & Discoveries, Decision Log,
and Outcomes & Retrospective must be kept up to date as work proceeds.

## Purpose / Big Picture

What someone gains after this change and how they can see it working.

## Assumptions

Temporary assumptions that unblock planning. Must be confirmed or removed by end.

## Open Questions

Unresolved questions. For each, note impacted plan sections.

## Progress

- [x] (2026-03-25 13:00Z) Example completed step.
- [ ] Example incomplete step.

## Surprises & Discoveries

- Observation: ...
  Evidence: ...

## Decision Log

- Decision: ...
  Rationale: ...

## Context and Orientation

Current state relevant to this task. Name key files by full path. Define non-obvious terms.

## Plan of Work

Sequence of edits and additions. Name files, functions, and what to change.

## Validation and Acceptance

How to verify the feature works.

## Idempotence and Recovery

Can steps be repeated safely? If risky, provide rollback path.

## Outcomes & Retrospective

Summarize outcomes and lessons learned at completion.
```

## Plan Lifecycle

- **Active**: `plans/<plan-name>.md`
- **Done**: `plans/done/<plan-name>.md` — move when PR is created
- **Abandoned**: `plans/abandoned/<plan-name>.md` — add note explaining why

$ARGUMENTS
