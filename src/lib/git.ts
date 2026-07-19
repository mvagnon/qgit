import { readdir } from "node:fs/promises";
import { join } from "node:path";

import { x } from "tinyexec";

import { parseBranches, parseDefaultBranch } from "./branches";

const UPSTREAM_REF = "@{upstream}";
const BRANCH_FORMAT = "%(refname:short)";

async function git(args: string[], cwd?: string): Promise<string> {
  const result = await x("git", args, { nodeOptions: { cwd } });
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || `git ${args.join(" ")} failed`);
  }
  return result.stdout;
}

async function tryGit(args: string[], cwd?: string): Promise<string | null> {
  const result = await x("git", args, { nodeOptions: { cwd } });
  return result.exitCode === 0 ? result.stdout : null;
}

export async function stageAll(): Promise<void> {
  await git(["add", "-A"]);
}

export async function getStagedDiff(): Promise<string> {
  return git(["diff", "--cached"]);
}

export async function commit(message: string): Promise<void> {
  await git(["commit", "-m", message]);
}

export async function currentBranch(): Promise<string> {
  return (await git(["symbolic-ref", "--short", "HEAD"])).trim();
}

export async function hasUpstream(): Promise<boolean> {
  const result = await tryGit(["rev-parse", "--abbrev-ref", "--symbolic-full-name", UPSTREAM_REF]);
  return result !== null;
}

export async function push(): Promise<void> {
  await git(["push"]);
}

export async function pushSetUpstream(branch: string): Promise<void> {
  await git(["push", "-u", "origin", branch]);
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
  await git(["fetch", "--prune"], repo);
}

export async function defaultBranch(repo: string): Promise<string | null> {
  const output = await tryGit(
    ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"],
    repo,
  );
  return output === null ? null : parseDefaultBranch(output);
}

export async function currentBranchAt(repo: string): Promise<string | null> {
  const output = await tryGit(["symbolic-ref", "--quiet", "--short", "HEAD"], repo);
  return output === null ? null : output.trim();
}

export async function localBranches(repo: string): Promise<string[]> {
  return parseBranches(await git(["branch", `--format=${BRANCH_FORMAT}`], repo));
}

export async function switchBranch(repo: string, branch: string): Promise<void> {
  await git(["switch", branch], repo);
}

export async function deleteBranch(repo: string, branch: string): Promise<void> {
  await git(["branch", "-D", branch], repo);
}

export async function pull(repo: string): Promise<void> {
  await git(["pull"], repo);
}
