---
description: Log a knowledge entry from the current work session into problem-logs
allowed-tools: Bash, Read, Edit, Write, Grep, Glob
---

# Log Knowledge Entry

Capture insights from the current work session as a structured problem log.

## Step 1: Gather Context

Review the recent conversation and identify:
- What problem was being solved
- What was confusing or non-obvious
- What the key insight or solution was
- What pitfalls to watch for in the future

## Step 2: Write the Log

Create a new file in `problem-logs/` following the naming convention:
`{YYYY-MM-DD}-{ticket-or-topic}-{slug}.md`

Use this template:

```markdown
---
date: YYYY-MM-DD
type: coding
problem: <one-line problem title>
tags: ["tag1", "tag2"]
---

## Problem
<What was the issue?>

## Initial Observations
<What did you see first? What was misleading?>

## Approach
<How was the problem investigated?>

## Key Insights
<The core learning — what was non-obvious?>

## Solution
<What fixed it?>

## Pitfalls / What to Watch For
<Future gotchas related to this>

## Study Prompts (Q&A)
Q: <question that tests understanding>
A: <answer>
---
Q: <another question>
A: <answer>
```

## Step 3: Confirm

Show the user the file path and a brief summary of what was logged.

$ARGUMENTS
