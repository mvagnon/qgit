# zapdev

**zapdev** — a lightweight TypeScript CLI that makes small, repetitive git chores fast and precise.

## Requirements

Node.js >= 20 and git.

## Install

```bash
npm install -g zapdev   # installs the `zapdev` command globally
```

Or run it once without installing:

```bash
npx zapdev commit
```

> For daily use, prefer the global install: `npx` adds resolution overhead on every run.

## Usage

Run `zapdev` with no command to pick one from an interactive menu (falls back to usage output without a TTY).

### `zapdev commit`

Stages all changes (`git add -A`), asks an Ollama model for a one-line Conventional Commits message, then lets you commit, edit or cancel, and optionally push.

```bash
zapdev commit
```

| Flag | Description |
| --- | --- |
| `-m, --model <model>` | Override the Ollama model |
| `-t, --type <type>` | Force the Conventional Commits type (`feat`, `fix`, `chore`, …) |
| `--pull` | Rebase onto upstream (`git pull --rebase`) after committing, before pushing |
| `-p, --push` | Push after committing without asking |
| `-y, --yes` | Skip prompts and commit directly |

```bash
zapdev commit -t feat      # force the type; the model still writes scope + description
```

Pushing is optimistic — no preliminary fetch, so the common case stays a single round-trip. If the push is rejected because the branch is behind its upstream, in a TTY it offers to `git pull --rebase` and retry; non-interactively (`--yes` / piped) it stops and asks you to re-run with `--pull`. Pass `--pull` to rebase onto upstream right after the commit (a rebase conflict stops before pushing). `--yes` only silences prompts; it never rebases on its own.

Without a TTY (piped / CI), it commits automatically and only pushes when `--push` is set.

### `zapdev reset`

Operates on a git repo, or — when the path is a plain directory — on its **direct child** repos (level 1, non-recursive). For each one: `git fetch --prune`, switch to a branch (chosen interactively, or forced with `--principal` / `--target`), then permanently delete every other local branch and every linked worktree. The principal branch (from `origin/HEAD`) and the branch you switched to are always kept. Ends with an optional `pull`.

```bash
zapdev reset                 # the current repo, or the child repos of the current directory
zapdev reset ~/dev           # a repo, or the child repos of a directory
zapdev reset -p              # switch each repo to its principal branch, no prompt
zapdev reset -t dev          # switch each repo to `dev` (or principal if absent)
```

| Flag | Description |
| --- | --- |
| `-p, --principal` | Switch every repo to its resolved principal branch (`origin/HEAD`) |
| `-t, --target <branch>` | Switch every repo to `<branch>`, falling back to the principal one |
| `--pull` | Pull the checked-out branch after reset without asking |
| `-y, --yes` | Non-interactive: switch and delete without confirmation |

Deletion is permanent: branches via `git branch -D` (force), worktrees via `git worktree remove --force`. Worktrees are removed first so the branches they held become deletable. Without a TTY, pass `--yes` — otherwise the destructive step is refused. `node_modules` is never scanned.

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `OLLAMA_URL` | `http://localhost:11434` | Ollama base URL |
| `OLLAMA_MODEL` | `deepseek-v4-flash:cloud` | Model used to generate messages |

## Development

From a clone:

```bash
npm install
npm run zapdev      # build then run the CLI in dev
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm run test        # vitest
npm run build       # bundle to dist/ (esbuild)
```

`npm link` (after `npm run build`) exposes the local `zapdev` binary on your PATH.

## Project structure

- `src/index.ts` — bin launcher; enables the V8 compile cache, then loads `cli.js`.
- `src/cli.ts` — CLI entry (Citty); registers subcommands, defaults to `commit`.
- `src/commands/` — one file per command.
- `src/lib/` — pure logic (`config`, `commit-message`, `branches`, unit-tested) and side effects (`git`, `ollama`); shared helpers (`errors`).
- `src/prompts/` — LLM prompts as `.md` files, imported as text (esbuild `.md` text loader) and inlined into the bundle at build time.
- `src/types/` — shared type declarations (one file per domain) and ambient module declarations.
