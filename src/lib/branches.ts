export function parseDefaultBranch(originHead: string): string | null {
  const trimmed = originHead.trim();
  if (!trimmed) return null;
  return trimmed.replace(/^origin\//, "");
}

export function parseBranches(raw: string): string[] {
  return raw
    .split("\n")
    .map((branch) => branch.trim())
    .filter(Boolean);
}

export function deletableBranches(all: string[], protectedBranches: string[]): string[] {
  const kept = new Set(protectedBranches.filter(Boolean));
  return all.filter((branch) => !kept.has(branch));
}
