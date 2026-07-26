# Working agreement

How to work in this repo. These load every session — they are constraints, not suggestions.

## Git — a hard boundary

- Make **file changes only**. Never create a branch, stage, commit, push, fetch, or rebase unless asked
  for that specific operation — because the user does all git themselves and reviews every changed file
  first. Read-only git (`status`, `diff`, `log`) to orient yourself is fine.
- If a branch or commit genuinely seems needed, suggest it and supply the commands. Do not run them.

## Planning

- "Make a plan" means **enter plan mode**: research, then present findings for approval via
  ExitPlanMode — because the user reviews plans before execution. Writing a plan file and starting to
  implement is not planning. Keep edits to the plan file until approved.
- Before calling ExitPlanMode, **adversarially audit the plan yourself**: re-derive each load-bearing
  claim, *run* the verification commands the plan proposes to confirm they can actually fail, and state
  reversals and downgrades in the plan rather than quietly dropping them — because "audit this" has been
  the answer to every plan so far, and every round found real errors: greps whose expectation could
  never fail, overstated justifications, and recommendations that reversed on inspection.

## Claims

- Verify any load-bearing claim against a primary source (official docs, or an empirical check) before
  building on it — because this user adversarially audits plans, and reversed findings have silently
  broken things before. When an audit's direction is right but its mechanism is wrong, say so precisely
  rather than accepting it wholesale.

## Execution

- Once a decision is settled, implement it fully in the same pass, and write docs in the present tense
  describing what IS — because deferring agreed work "until the consumer lands" and hedging docs in
  future tense was called waffle. Reserve deferral for genuinely blocked work.

## Documentation layering

- **README = how-to · CLAUDE.md = rationale + pointer · `docs/<name>.md` = full detail.** Push
  architecture, decision tables, gotchas, and roadmaps into `docs/` and leave CLAUDE.md a short
  rationale plus a link — because CLAUDE.md loads every session, so length costs context and reduces
  adherence.
- **`.claude/rules/*.md` is a fourth surface, split by kind rather than depth**: enforceable rules to
  follow *while writing code* go here; CLAUDE.md describes what the repo *is*. A repo-wide convention
  belongs here, not in a per-directory `CLAUDE.md`, which should carry only what is specific to that
  directory. These load every session too, so the same length discipline applies.
- **CLAUDE.md stays under 200 lines** — official guidance, because longer files consume more context and
  reduce adherence. Before finishing any edit to it, run `wc -l CLAUDE.md`; if it is at or over 200, push
  detail into the subsystem's `docs/` chronicle instead of shipping the growth. Check words too, not just
  lines — rewrapping wider hits the line target without saving any context.
- Update README **and** CLAUDE.md in the same change for anything more than cosmetic.
- Personal or machine-specific settings — editor trusted-domains, credentials, local paths — never go in
  tracked repo config, because a shared file silently opts in everyone who clones.
