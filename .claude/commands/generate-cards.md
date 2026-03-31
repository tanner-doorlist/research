---
description: Generate study cards from unprocessed problem logs
allowed-tools: Bash, Read, Grep, Glob
---

# Generate Study Cards

Run the study card generation pipeline to convert new problem logs into flashcards.

## Steps

1. Check for unprocessed logs:
   - Read `study-cards/.processed_logs.json` to see which logs have been processed
   - List files in `problem-logs/` to find new ones

2. Run the generator:
   ```bash
   cd /Users/tannerhornsby/research
   python3 generate_study_cards.py --logs-dir ./problem-logs --output-dir ./study-cards --new-only
   ```

3. Report results:
   - How many new logs were processed
   - How many Q&A cards were generated
   - How many concept cards were generated

If the script fails, check that `ANTHROPIC_API_KEY` is set and show the error.

$ARGUMENTS
