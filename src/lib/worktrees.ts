import type { Worktree } from "../types/worktree";

const WORKTREE_PREFIX = "worktree ";
const BRANCH_PREFIX = "branch ";

// Parses `git worktree list --porcelain`: one block per worktree (main first),
// blocks separated by blank lines. A `detached` block has no `branch` line.
export function parseWorktrees(porcelain: string): Worktree[] {
  const worktrees: Worktree[] = [];
  let current: Worktree | null = null;

  for (const line of porcelain.split("\n")) {
    if (line.startsWith(WORKTREE_PREFIX)) {
      current = { path: line.slice(WORKTREE_PREFIX.length).trim(), branch: null };
      worktrees.push(current);
    } else if (current && line.startsWith(BRANCH_PREFIX)) {
      current.branch = line.slice(BRANCH_PREFIX.length).trim().replace(/^refs\/heads\//, "");
    }
  }

  return worktrees;
}
