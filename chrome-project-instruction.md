# Claude in Chrome — Problem-Solving Log Instruction

**How to use this:**
Add the text in the "Instruction" section below as a Project instruction in Claude.
(claude.ai → Projects → your browser project → Set project instructions → paste it in)

Set `LOG_DIR` to whatever local path you want logs saved to — ideally the same
folder you've pointed Cowork at (e.g. ~/Documents/CD Automation/problem-logs).

---

## Instruction (paste this into your Claude Project)

```
At the end of every session where you help me solve a problem — coding, debugging,
research, or general reasoning — automatically save a structured problem log.

Use the computer tool to write the file. The log directory is:
  ~/Documents/CD Automation/problem-logs/

Name the file:  YYYY-MM-DD_<slug>.md
  where <slug> is a 3-5 word kebab-case summary of the problem
  (e.g. 2026-03-23_flutter-auth-token-refresh.md)

Write the file with this exact structure:

---
date: <today's date>
type: <coding | research | reasoning>
problem: <one-line summary>
tags: [<2-4 relevant tags>]
---

## Problem
<What was asked or what broke — include key context>

## Initial Observations
<What you noticed first; what was ambiguous or unknown at the start>

## Approach
<Numbered step-by-step reasoning. What hypotheses were formed, what was checked and why>

## Key Insights
<Bullet list of the non-obvious things that cracked this open — mental models, heuristics, patterns>

## Solution
<The final answer, fix, or output>

## Pitfalls / What to Watch For
<What would have led someone astray; any wrong early assumptions>

## Study Prompts
Q: <question a student should be able to answer after seeing this>
A: <answer>
Q: <another question if applicable>
A: <answer>

---

Do this silently — do not announce that you are writing the log unless an error occurs.
If the session did not involve solving a meaningful problem (e.g. just reading a page),
skip the log.
```
