import { readdir } from "node:fs/promises";
import { join } from "node:path";

import { $ } from "bun";

import { parseBranches, parseDefaultBranch } from "./branches";

const UPSTREAM_REF = "@{upstream}";
const BRANCH_FORMAT = "%(refname:short)";

export async function stageAll(): Promise<void> {
  await $`git add -A`.quiet();
}

export async function getStagedDiff(): Promise<string> {
  return await $`git diff --cached`.quiet().text();
}

export async function commit(message: string): Promise<void> {
  await $`git commit -m ${message}`.quiet();
}

export async function currentBranch(): Promise<string> {
  return (await $`git symbolic-ref --short HEAD`.quiet().text()).trim();
}

export async function hasUpstream(): Promise<boolean> {
  const result = await $`git rev-parse --abbrev-ref --symbolic-full-name ${UPSTREAM_REF}`
    .nothrow()
    .quiet();
  return result.exitCode === 0;
}

export async function push(): Promise<void> {
  await $`git push`.quiet();
}

export async function pushSetUpstream(branch: string): Promise<void> {
  await $`git push -u origin ${branch}`.quiet();
}

export async function findGitRepos(start: string): Promise<string[]> {
  const repos: string[] = [];
  await collectRepos(start, repos);
  return repos.sort();
}

// Prune at each repo boundary (a `.git` entry): we never descend into a repo, so
// submodules and a repo's node_modules are skipped, unlike the original `find` walk.
async function collectRepos(dir: string, repos: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => null);
  if (!entries) return;

  if (entries.some((entry) => entry.name === ".git")) {
    repos.push(dir);
    return;
  }

  const subdirs = entries.filter(
    (entry) => entry.isDirectory() && entry.name !== "node_modules",
  );
  await Promise.all(subdirs.map((entry) => collectRepos(join(dir, entry.name), repos)));
}

export async function fetchPrune(repo: string): Promise<void> {
  await $`git fetch --prune`.cwd(repo).quiet();
}

export async function defaultBranch(repo: string): Promise<string | null> {
  const result = await $`git symbolic-ref --quiet --short refs/remotes/origin/HEAD`
    .cwd(repo)
    .nothrow()
    .quiet();
  return result.exitCode === 0 ? parseDefaultBranch(result.text()) : null;
}

export async function currentBranchAt(repo: string): Promise<string | null> {
  const result = await $`git symbolic-ref --quiet --short HEAD`.cwd(repo).nothrow().quiet();
  return result.exitCode === 0 ? result.text().trim() : null;
}

export async function localBranches(repo: string): Promise<string[]> {
  return parseBranches(await $`git branch --format=${BRANCH_FORMAT}`.cwd(repo).quiet().text());
}

export async function switchBranch(repo: string, branch: string): Promise<void> {
  await $`git switch ${branch}`.cwd(repo).quiet();
}

export async function deleteBranch(repo: string, branch: string): Promise<void> {
  await $`git branch -D ${branch}`.cwd(repo).quiet();
}

export async function pull(repo: string): Promise<void> {
  await $`git pull`.cwd(repo).quiet();
}
