# zapdev

**zapdev** — a lightweight TypeScript/Bun CLI that makes small, repetitive git chores fast and precise.

## Requirements

zapdev runs on the [Bun](https://bun.sh) runtime. Install Bun first.

## Install

```bash
bun add -g zapdev   # installs the `zapdev` command globally
```

Or run it once without installing:

```bash
bunx zapdev commit
```

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
| `-p, --push` | Push after committing without asking |
| `-y, --yes` | Skip prompts and commit directly |

Without a TTY (piped / CI), it commits automatically and only pushes when `--push` is set.

### `zapdev cleanup`

Walks a directory for git repos, and for each one: `git fetch --prune`, lets you switch to the default branch (from `origin/HEAD`) or stay on the current one, interactively deletes stale local branches, then optionally pulls.

```bash
zapdev cleanup            # scan the current directory
zapdev cleanup ~/dev      # scan a specific directory
```

| Flag | Description |
| --- | --- |
| `-s, --stay` | Stay on the current branch instead of switching to the default |
| `-p, --pull` | Pull the checked-out branch after cleanup without asking |
| `-y, --yes` | Non-interactive: switch to default and delete every other local branch |

Deletion uses `git branch -D` (force). Without a TTY (or with `--yes`), every non-default branch is deleted automatically. The walk prunes at each repo, so submodules and `node_modules` are never scanned.

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `OLLAMA_URL` | `http://localhost:11434` | Ollama base URL |
| `OLLAMA_MODEL` | `deepseek-v4-flash:cloud` | Model used to generate messages |

## Development

From a clone:

```bash
bun install
bun run zapdev      # run the CLI in dev
bun run typecheck   # tsc --noEmit
bun run lint        # eslint
bun run test        # vitest
bun run build       # bundle to dist/
```

`bun link` (after `bun run build`) exposes the local `zapdev` binary on your PATH.

## Project structure

- `src/index.ts` — CLI entry (Citty); registers subcommands, defaults to `commit`.
- `src/commands/` — one file per command.
- `src/lib/` — pure logic (`config`, `commit-message`, `branches`, unit-tested) and side effects (`git`, `ollama`); shared helpers (`errors`).
