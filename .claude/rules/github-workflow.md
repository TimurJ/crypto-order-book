# GitHub workflow

## Before any write

- Show the exact content and get explicit approval before **any** `gh` write — PR or issue comments, PR
  descriptions, review submissions — **even in auto-accept mode**. Draft → show verbatim → wait → then
  run. Because these are outward-facing and represent the user publicly, and GitHub keeps edit history,
  so undoing is awkward rather than clean.

## PR bodies

- Do not offer, draft, or nag about PR descriptions. An empty body is intentional — because the
  `docs/*-setup.md` chronicles, CLAUDE.md, README, and thorough Conventional-Commit messages already
  carry the detail. Reviewing diffs and checks is still welcome.
- **Never replace a PR body.** `gh pr edit --body/--body-file` overwrites the whole thing, and PRs here
  start from `.github/PULL_REQUEST_TEMPLATE.md` with checklist boxes the user filled in. Fetch first
  (`gh pr view N --json body`), insert under `## Summary`, write the merged result back. Recover a
  clobbered body via GraphQL `pullRequest.userContentEdits`, which returns prior versions in `diff`.
- **Never hard-wrap a GitHub body.** One unwrapped line per paragraph and per list item, blank lines only
  between blocks — because GitHub renders this markdown with `breaks: true`, so every newline becomes a
  `<br>` and wrapped prose displays as a narrow left column. This is the opposite of the repo's
  source-file convention. Verify with `gh pr view <n> --json body -q .body | cat -e`: each paragraph
  should be one line ending in a single `$`. (Use `cat -e`, not `cat -A` — BSD/macOS `cat` has no `-A`.)

## Branches and merges

- Branch names are `<conventional-type>/<kebab-slug>` — `chore/add-husky`, `feat/order-book-ui`. Use the
  type you'd use in the commit subject. You don't create branches (see the git boundary), but you do
  supply the commands, so name them right.
- If you propose a **PR title**, write it as a valid Conventional Commit. Squash is the only merge
  strategy here and the repo squashes with `PR_TITLE`, so the title becomes the commit subject on `main` —
  and CI's `commits` job lints the branch's commit range, never the title. It is the one subject no gate
  checks. Full mechanism: `docs/ci-setup.md` §4 gotcha 8.
