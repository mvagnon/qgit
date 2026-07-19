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
  commit as gitCommit,
  currentBranch,
  getStagedDiff,
  hasUpstream,
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
      const pushLoader = interactive ? spinner() : undefined;
      pushLoader?.start("Pushing");
      try {
        const [upstream, branch] = await Promise.all([hasUpstream(), currentBranch()]);
        if (upstream) await push();
        else await pushSetUpstream(branch);
        pushLoader?.stop("✓ Pushed");
      } catch (error) {
        pushLoader?.error("Push failed");
        log.error(`Push failed: ${errorMessage(error)}`);
        process.exitCode = 1;
        return;
      }
    }

    if (interactive) outro("Done.");
  },
});
