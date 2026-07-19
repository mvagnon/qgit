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
} from "@clack/prompts";

import { deletableBranches } from "../lib/branches";
import { errorMessage } from "../lib/errors";
import {
  branchExists,
  currentBranchAt,
  defaultBranch,
  deleteBranch,
  fetchPrune,
  findChildRepos,
  listWorktrees,
  localBranches,
  pull,
  removeWorktree,
  switchBranch,
} from "../lib/git";
import type { Worktree } from "../types/worktree";

type ResetOptions = { principal: boolean; target: string; pull: boolean };

const CANCEL = Symbol("cancel");

export const resetCommand = defineCommand({
  meta: {
    name: "reset",
    description:
      "Switch every child repo to a branch, then delete all other local branches and worktrees.",
  },
  args: {
    path: {
      type: "positional",
      required: false,
      default: ".",
      description: "Parent directory whose direct child repos are reset.",
    },
    principal: {
      type: "boolean",
      alias: "p",
      description: "Switch every repo to its resolved principal branch (origin/HEAD).",
    },
    target: {
      type: "string",
      alias: "t",
      description: "Switch every repo to this branch, falling back to the principal one.",
    },
    pull: {
      type: "boolean",
      description: "Pull the checked-out branch after reset without asking.",
    },
    yes: {
      type: "boolean",
      alias: "y",
      description: "Non-interactive: switch and delete without confirmation.",
    },
  },
  async run({ args }) {
    const assumeYes = Boolean(args.yes);
    const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY) && !assumeYes;
    const options: ResetOptions = {
      principal: Boolean(args.principal),
      target: typeof args.target === "string" ? args.target.trim() : "",
      pull: Boolean(args.pull),
    };
    const path = args.path || ".";

    if (interactive) intro("zapdev reset");

    const repos = await findChildRepos(path);
    if (repos.length === 0) {
      log.warn(`No child git repository found under ${path}.`);
      if (interactive) outro("Nothing to do.");
      return;
    }

    for (const repo of repos) {
      try {
        const cancelled = await resetRepo(repo, options, interactive, assumeYes);
        if (cancelled) {
          cancel("Cancelled.");
          return;
        }
      } catch (error) {
        log.error(`Skipped ${repo}: ${errorMessage(error)}`);
      }
    }

    if (interactive) outro(`Done (${repos.length} repo${repos.length > 1 ? "s" : ""}).`);
  },
});

// Returns true when the user cancelled a prompt (abort the whole run); repo-level
// failures are logged and skipped without aborting the other repos.
async function resetRepo(
  repo: string,
  options: ResetOptions,
  interactive: boolean,
  assumeYes: boolean,
): Promise<boolean> {
  log.step(`Resetting ${repo}`);

  const fetchLoader = interactive ? spinner() : undefined;
  fetchLoader?.start("Fetching + pruning…");
  try {
    await fetchPrune(repo);
    fetchLoader?.stop("Fetched + pruned");
  } catch (error) {
    fetchLoader?.error("Fetch failed");
    log.warn(`  Fetch failed, continuing: ${errorMessage(error)}`);
  }

  const [principal, current] = await Promise.all([defaultBranch(repo), currentBranchAt(repo)]);

  const endBranch = await resolveEndBranch(repo, principal, current, options, interactive);
  if (endBranch === CANCEL) return true;
  if (endBranch === null) return false;

  const [branches, worktrees] = await Promise.all([localBranches(repo), listWorktrees(repo)]);
  const branchesToDelete = deletableBranches(branches, [principal ?? "", endBranch]);
  const worktreesToRemove = worktrees.slice(1);

  if (branchesToDelete.length > 0 || worktreesToRemove.length > 0) {
    if (!assumeYes) {
      if (!interactive) {
        log.warn("  Refusing to delete non-interactively; pass --yes.");
        return false;
      }
      announcePlan(endBranch, branchesToDelete, worktreesToRemove);
      const ok = await confirm({ message: "Delete permanently?", initialValue: false });
      if (isCancel(ok)) return true;
      if (!ok) {
        log.info("  Skipped.");
        return false;
      }
    }
    await removeWorktrees(repo, worktreesToRemove);
  }

  if (!(await switchTo(repo, current, endBranch))) return false;

  if (branchesToDelete.length > 0) await deleteBranches(repo, branchesToDelete);

  return maybePull(repo, endBranch, options, interactive);
}

async function resolveEndBranch(
  repo: string,
  principal: string | null,
  current: string | null,
  options: ResetOptions,
  interactive: boolean,
): Promise<string | null | typeof CANCEL> {
  if (options.target) {
    if (await branchExists(repo, options.target)) return options.target;
    if (principal) return principal;
    log.warn(`  Target "${options.target}" not found and no origin/HEAD; skipped.`);
    return null;
  }

  if (options.principal || !interactive) {
    if (principal) return principal;
    log.warn("  No origin/HEAD to resolve the principal branch; skipped.");
    return null;
  }

  const branches = await localBranches(repo);
  if (branches.length === 0) return principal;

  const choice = await select({
    message: "Switch to:",
    initialValue: principal ?? current ?? branches[0],
    options: branches.map((branch) => ({
      value: branch,
      label: branch === principal ? `${branch} (principal)` : branch,
    })),
  });
  if (isCancel(choice)) return CANCEL;
  return choice;
}

function announcePlan(endBranch: string, branches: string[], worktrees: Worktree[]): void {
  log.info(`  Switch to ${endBranch}`);
  if (branches.length > 0) {
    const label = branches.length > 1 ? "branches" : "branch";
    log.warn(`  Delete ${branches.length} ${label}: ${branches.join(", ")}`);
  }
  if (worktrees.length > 0) {
    const label = worktrees.length > 1 ? "worktrees" : "worktree";
    const paths = worktrees.map((worktree) => worktree.path).join(", ");
    log.warn(`  Remove ${worktrees.length} ${label}: ${paths}`);
  }
}

async function removeWorktrees(repo: string, worktrees: Worktree[]): Promise<void> {
  let removed = 0;
  for (const worktree of worktrees) {
    try {
      await removeWorktree(repo, worktree.path);
      removed += 1;
    } catch (error) {
      log.error(`  Could not remove worktree ${worktree.path}: ${errorMessage(error)}`);
    }
  }
  if (removed > 0) log.success(`  Removed ${removed} worktree${removed > 1 ? "s" : ""}.`);
}

// Returns false when the switch failed (skip the rest of this repo).
async function switchTo(repo: string, current: string | null, endBranch: string): Promise<boolean> {
  if (current === endBranch) return true;
  try {
    await switchBranch(repo, endBranch);
    return true;
  } catch (error) {
    log.error(`  Could not switch to ${endBranch}: ${errorMessage(error)}`);
    return false;
  }
}

async function deleteBranches(repo: string, branches: string[]): Promise<void> {
  let deleted = 0;
  for (const branch of branches) {
    try {
      await deleteBranch(repo, branch);
      deleted += 1;
    } catch (error) {
      log.error(`  Could not delete ${branch}: ${errorMessage(error)}`);
    }
  }
  if (deleted > 0) log.success(`  Deleted ${deleted} branch${deleted > 1 ? "es" : ""}.`);
}

async function maybePull(
  repo: string,
  endBranch: string,
  options: ResetOptions,
  interactive: boolean,
): Promise<boolean> {
  let shouldPull = options.pull;
  if (!shouldPull && interactive) {
    const answer = await confirm({ message: `Pull ${endBranch}?`, initialValue: false });
    if (isCancel(answer)) return true;
    shouldPull = answer;
  }

  if (shouldPull) {
    const loader = interactive ? spinner() : undefined;
    loader?.start(`Pulling ${endBranch}…`);
    try {
      await pull(repo);
      loader?.stop(`✓ Pulled ${endBranch}`);
    } catch (error) {
      loader?.error("Pull failed");
      log.error(`  Pull failed: ${errorMessage(error)}`);
    }
  }

  return false;
}
