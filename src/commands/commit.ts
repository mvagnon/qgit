import { defineCommand } from "citty";
import {
  cancel,
  confirm,
  intro,
  isCancel,
  log,
  outro,
  select,
  spinner,
  text,
} from "@clack/prompts";

import { normalizeCommitType } from "../lib/commit-message";
import { resolveConfig } from "../lib/config";
import {
  behindCount,
  commit as gitCommit,
  currentBranch,
  fetchRemote,
  getStagedDiff,
  hasUpstream,
  pullRebase,
  push,
  pushSetUpstream,
  stageAll,
} from "../lib/git";
import { errorMessage } from "../lib/errors";
import { generateCommitMessage } from "../lib/ollama";
import { COMMIT_TYPES } from "../types/commit";

type CommitAction = "commit" | "edit" | "cancel";

export const commitCommand = defineCommand({
  meta: {
    name: "commit",
    description:
      "Stage all changes and commit with an LLM-generated Conventional Commits message.",
  },
  args: {
    model: {
      type: "string",
      alias: "m",
      description: "Override the Ollama model (defaults to $OLLAMA_MODEL).",
    },
    type: {
      type: "string",
      alias: "t",
      description: `Force the Conventional Commits type (${COMMIT_TYPES.join(", ")}).`,
    },
    pull: {
      type: "boolean",
      description: "Rebase onto upstream (git pull --rebase) after committing, before pushing.",
    },
    push: {
      type: "boolean",
      alias: "p",
      description: "Push after committing without asking.",
    },
    yes: {
      type: "boolean",
      alias: "y",
      description: "Skip prompts and commit directly.",
    },
  },
  async run({ args }) {
    const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
    const config = resolveConfig(
      process.env,
      args.model ? { model: args.model } : {},
    );

    const type = args.type ? normalizeCommitType(args.type) : undefined;
    if (type === null) {
      log.error(
        `Invalid type "${args.type}". Valid types: ${COMMIT_TYPES.join(", ")}.`,
      );
      process.exitCode = 1;
      return;
    }

    if (interactive) intro("zapdev commit");

    await stageAll();
    const diff = await getStagedDiff();
    if (!diff.trim()) {
      log.warn("Nothing to commit.");
      if (interactive) outro("Nothing to do.");
      return;
    }

    const loader = interactive ? spinner() : undefined;
    loader?.start("Generating commit message");

    let message: string;
    try {
      message = await generateCommitMessage(diff, config, type);
    } catch (error) {
      loader?.error("Generation failed");
      log.error(`Generation failed: ${errorMessage(error)}`);
      process.exitCode = 1;
      return;
    }

    if (!message) {
      loader?.error("Generation failed");
      log.error("Generation failed: the model returned an empty message.");
      process.exitCode = 1;
      return;
    }

    if (loader) loader.stop(message);
    else log.message(message);

    let finalMessage = message;

    if (interactive && !args.yes) {
      const action = await select<CommitAction>({
        message: "Action",
        initialValue: "commit",
        options: [
          { value: "commit", label: "Commit" },
          { value: "edit", label: "Edit message" },
          { value: "cancel", label: "Cancel" },
        ],
      });

      if (isCancel(action) || action === "cancel") {
        cancel("Cancelled (changes left staged).");
        return;
      }

      if (action === "edit") {
        const edited = await text({
          message: "Edit message",
          initialValue: message,
        });
        if (isCancel(edited)) {
          cancel("Cancelled (changes left staged).");
          return;
        }
        finalMessage = edited.trim();
        if (!finalMessage) {
          cancel("Empty message, cancelled.");
          return;
        }
      }
    }

    await gitCommit(finalMessage);
    if (interactive) log.success(`Committed: ${finalMessage}`);

    if (args.pull && !(await rebaseOnUpstream(interactive))) {
      process.exitCode = 1;
      return;
    }

    let shouldPush = Boolean(args.push);
    if (!shouldPush && interactive && !args.yes) {
      const answer = await confirm({ message: "Push?", initialValue: false });
      if (isCancel(answer)) {
        if (interactive) outro("Committed. Not pushed.");
        return;
      }
      shouldPush = answer;
    }

    if (shouldPush) {
      const pushed = await pushOptimistic(interactive, Boolean(args.yes));
      if (!pushed) {
        process.exitCode = 1;
        return;
      }
    }

    if (interactive) outro("Done.");
  },
});

// Rebases the current branch onto its upstream. Returns false on a rebase
// conflict so the caller stops before pushing.
async function rebaseOnUpstream(interactive: boolean): Promise<boolean> {
  if (!(await hasUpstream())) {
    log.info("No upstream to pull from; skipping --pull.");
    return true;
  }

  const loader = interactive ? spinner() : undefined;
  loader?.start("Pulling --rebase");
  try {
    await pullRebase();
    loader?.stop("✓ Rebased on upstream");
    return true;
  } catch (error) {
    loader?.error("Rebase failed");
    log.error(`Rebase failed (resolve conflicts, then push): ${errorMessage(error)}`);
    return false;
  }
}

// Pushes without a preliminary fetch, so the common case stays a single round-trip.
// On failure, diagnoses "behind upstream" by fetching and comparing (only on this
// rare path) rather than parsing stderr. A behind rejection is recovered
// interactively (rebase + retry once); non-interactively it points to --pull.
async function pushOptimistic(interactive: boolean, assumeYes: boolean): Promise<boolean> {
  const [upstream, branch] = await Promise.all([hasUpstream(), currentBranch()]);
  const doPush = () => (upstream ? push() : pushSetUpstream(branch));

  const first = await tryPush(interactive, doPush);
  if (first.ok) return true;

  if (upstream && (await isBehind(interactive))) {
    if (assumeYes || !interactive) {
      log.error("Behind upstream — re-run with --pull to rebase and push.");
      return false;
    }

    const answer = await confirm({ message: "Pull --rebase and retry push?", initialValue: true });
    if (isCancel(answer) || !answer) {
      log.info("Not pushed (still behind).");
      return true;
    }

    if (!(await rebaseOnUpstream(interactive))) return false;

    const retry = await tryPush(interactive, doPush);
    if (retry.ok) return true;
    log.error(`Push failed: ${errorMessage(retry.error)}`);
    return false;
  }

  log.error(`Push failed: ${errorMessage(first.error)}`);
  return false;
}

type PushResult = { ok: true } | { ok: false; error: unknown };

async function tryPush(interactive: boolean, doPush: () => Promise<void>): Promise<PushResult> {
  const loader = interactive ? spinner() : undefined;
  loader?.start("Pushing");
  try {
    await doPush();
    loader?.stop("✓ Pushed");
    return { ok: true };
  } catch (error) {
    loader?.error("Push failed");
    return { ok: false, error };
  }
}

// Fetches, then checks whether the branch trails its upstream. A failed fetch
// (offline, auth) is treated as "not behind" so the original push error surfaces.
async function isBehind(interactive: boolean): Promise<boolean> {
  const loader = interactive ? spinner() : undefined;
  loader?.start("Checking upstream");
  try {
    await fetchRemote();
    const behind = await behindCount();
    loader?.stop(
      behind > 0
        ? `Behind upstream by ${behind} commit${behind > 1 ? "s" : ""}`
        : "Up to date with upstream",
    );
    return behind > 0;
  } catch (error) {
    loader?.error("Could not check upstream");
    log.warn(`Could not check upstream: ${errorMessage(error)}`);
    return false;
  }
}
