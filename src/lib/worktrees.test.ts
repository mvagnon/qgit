import { describe, expect, it } from "vitest";

import { parseWorktrees } from "./worktrees";

describe("parseWorktrees", () => {
  it("parses the main and linked worktrees with short branch names", () => {
    const porcelain = [
      "worktree /repo",
      "HEAD aaa",
      "branch refs/heads/main",
      "",
      "worktree /repo-feat",
      "HEAD bbb",
      "branch refs/heads/feature/x",
      "",
    ].join("\n");

    expect(parseWorktrees(porcelain)).toEqual([
      { path: "/repo", branch: "main" },
      { path: "/repo-feat", branch: "feature/x" },
    ]);
  });

  it("marks a detached worktree with a null branch", () => {
    const porcelain = ["worktree /repo-det", "HEAD ccc", "detached", ""].join("\n");

    expect(parseWorktrees(porcelain)).toEqual([{ path: "/repo-det", branch: null }]);
  });

  it("returns an empty array for empty input", () => {
    expect(parseWorktrees("")).toEqual([]);
  });
});
