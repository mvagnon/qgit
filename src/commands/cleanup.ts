import { defineCommand } from "citty";
import {
  cancel,
  confirm,
  intro,
  isCancel,
  log,
  multiselect,
  outro,
  select,
  spinner,
} from "@clack/prompts";

import { deletableBranches } from "../lib/branches";
import { errorMessage } from "../lib/errors";
import {
  currentBranchAt,
  defaultBranch,
  deleteBranch,
  fetchPrune,
  findGitRepos,
  localBranches,
  pull,
  switchBranch,
} from "../lib/git";

type CleanupOptions = { stay: boolean; pull: boolean };

export const cleanupCommand = defineCommand({
  meta: {
    name: "cleanup",
    description: "Prune every git repo under a path, then delete stale local branches.",
  },
  args: {
    path: {
      type: "positional",
      required: false,
      default: ".",
      description: "Directory to scan for git repos (recursively).",
    },
    stay: {
      type: "boolean",
      alias: "s",
      description: "Stay on the current branch instead of switching to the default.",
    },
    pull: {
      type: "boolean",
      alias: "p",
      description: "Pull the checked-out branch after cleanup without asking.",
    },
    yes: {
      type: "boolean",
      alias: "y",
      description: "Non-interactive: switch to default and delete every other local branch.",
    },
  },
  async run({ args }) {
    const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY) && !args.yes;
    const options: CleanupOptions = { stay: Boolean(args.stay), pull: Boolean(args.pull) };
    const path = args.path || ".";

    if (interactive) intro("zapdev cleanup");

    const repos = await findGitRepos(path);
    if (repos.length === 0) {
      log.warn(`No git repository found under ${path}.`);
      if (interactive) outro("Nothing to do.");
      return;
    }

    for (const repo of repos) {
      const cancelled = await cleanupRepo(repo, options, interactive);
      if (cancelled) {
        cancel("Cancelled.");
        return;
      }
    }

    if (interactive) outro(`Done (${repos.length} repo${repos.length > 1 ? "s" : ""}).`);
  },
});

// Returns true when the user cancelled a prompt (abort the whole run); repo-level
// failures are logged and skipped without aborting the other repos.
async function cleanupRepo(
  repo: string,
  options: CleanupOptions,
  interactive: boolean,
): Promise<boolean> {
  log.step(`Cleaning ${repo}`);

  const fetchLoader = interactive ? spinner() : undefined;
  fetchLoader?.start("Fetching + pruning…");
  try {
    await fetchPrune(repo);
    fetchLoader?.stop("Fetched + pruned");
  } catch (error) {
    fetchLoader?.error("Fetch failed");
    log.warn(`  Fetch failed, continuing: ${errorMessage(error)}`);
  }

  const base = await defaultBranch(repo);
  if (!base) {
    log.warn("  Skipped: no origin/HEAD.");
    return false;
  }

  const current = await currentBranchAt(repo);

  let endBranch = base;
  if (current && current !== base) {
    if (options.stay) {
      endBranch = current;
    } else if (interactive) {
      const choice = await select({
        message: "After cleanup, be on:",
        initialValue: base,
        options: [
          { value: base, label: `Switch to ${base}` },
          { value: current, label: `Stay on ${current} (keep it)` },
        ],
      });
      if (isCancel(choice)) return true;
      endBranch = choice;
    }
  }

  if (current !== endBranch) {
    try {
      await switchBranch(repo, endBranch);
    } catch (error) {
      log.error(`  Could not switch to ${endBranch}: ${errorMessage(error)}`);
      return false;
    }
  }

  const candidates = deletableBranches(await localBranches(repo), [base, endBranch]);
  if (candidates.length === 0) {
    log.info("  No branch to delete.");
  } else {
    let toDelete = candidates;
    if (interactive) {
      const selected = await multiselect({
        message: "Branches to delete",
        options: candidates.map((branch) => ({ value: branch, label: branch })),
        required: false,
      });
      if (isCancel(selected)) return true;
      toDelete = selected;
    }

    let deleted = 0;
    for (const branch of toDelete) {
      try {
        await deleteBranch(repo, branch);
        deleted += 1;
      } catch (error) {
        log.error(`  Could not delete ${branch}: ${errorMessage(error)}`);
      }
    }
    if (deleted > 0) log.success(`  Deleted ${deleted} branch${deleted > 1 ? "es" : ""}.`);
  }

  let shouldPull = options.pull;
  if (!shouldPull && interactive) {
    const answer = await confirm({ message: `Pull ${endBranch}?`, initialValue: false });
    if (isCancel(answer)) return true;
    shouldPull = answer;
  }

  if (shouldPull) {
    const pullLoader = interactive ? spinner() : undefined;
    pullLoader?.start(`Pulling ${endBranch}…`);
    try {
      await pull(repo);
      pullLoader?.stop(`✓ Pulled ${endBranch}`);
    } catch (error) {
      pullLoader?.error("Pull failed");
      log.error(`  Pull failed: ${errorMessage(error)}`);
    }
  }

  return false;
}
