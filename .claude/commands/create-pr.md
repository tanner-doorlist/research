---
description: Review changes, create a branch, and open a PR with gh CLI
allowed-tools: Bash, Read, Edit, Write, Grep, Glob
---

# Create PR for Research Repo

## Workflow

### 1. Inspect the current changes
- `git status`, `git diff`, `git log -5`

### 2. Review changes
Before proceeding, review the diff for:
- No `.env` files or secrets being committed
- No large binary files or data dumps
- ChromaDB data not included
- Study card state files not included
- Code is clean and functional

### If issues are found: STOP and report to the user.

### 3. Ensure you are on a feature branch
- Never commit directly to `main`.
- If starting from `main`: `git switch -c <feature-branch-name>`

### 4. Stage and commit changes
- `git add <paths>`
- Make commits that tell the story; avoid dumping unrelated changes in one commit.

### 5. Push the branch
- First push: `git push -u origin <feature-branch-name>`

### 6. Create the PR with `gh`

Use a HEREDOC so the body stays formatted:

```
gh pr create \
  --title "<PR title>" \
  --body "$(cat <<'EOF'
## Summary
- ...

## Changes
- ...

## Testing
- Manual verification: ...

🤖 Generated with [Claude Code](https://claude.ai/code)
EOF
)"
```

## PR Titles

Prefer titles that front-load impact:
- `fix: repair ChromaDB dedup threshold logic`
- `feat: add new card type for code snippets`
- `refactor: consolidate study card generation`

## Constraints

- Never update `git config`.
- Only push/create a PR when explicitly asked.
- Use HEREDOCs for multi-line commit and PR messages.

$ARGUMENTS
