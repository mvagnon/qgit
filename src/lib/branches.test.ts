import { describe, expect, it } from "vitest";

import { deletableBranches, parseBranches, parseDefaultBranch } from "./branches";

describe("parseDefaultBranch", () => {
  it("strips the origin/ prefix", () => {
    expect(parseDefaultBranch("origin/main")).toBe("main");
  });

  it("keeps nested branch names after the first origin/", () => {
    expect(parseDefaultBranch("origin/release/next")).toBe("release/next");
  });

  it("trims surrounding whitespace", () => {
    expect(parseDefaultBranch("  origin/develop\n")).toBe("develop");
  });

  it("returns null when there is no origin/HEAD", () => {
    expect(parseDefaultBranch("")).toBeNull();
    expect(parseDefaultBranch("   ")).toBeNull();
  });
});

describe("parseBranches", () => {
  it("splits, trims and drops blank lines", () => {
    expect(parseBranches("main\n  feat/x  \n\nfix/y\n")).toEqual(["main", "feat/x", "fix/y"]);
  });

  it("returns an empty array for empty input", () => {
    expect(parseBranches("")).toEqual([]);
  });
});

describe("deletableBranches", () => {
  it("excludes protected branches while preserving order", () => {
    const all = ["main", "feat/x", "fix/y", "spike"];
    expect(deletableBranches(all, ["main", "feat/x"])).toEqual(["fix/y", "spike"]);
  });

  it("ignores empty protected entries", () => {
    expect(deletableBranches(["main", "feat/x"], ["main", ""])).toEqual(["feat/x"]);
  });

  it("returns everything when nothing is protected", () => {
    expect(deletableBranches(["a", "b"], [])).toEqual(["a", "b"]);
  });
});
