import { spawnSync } from "node:child_process";
import { resolve, join } from "node:path";
import { existsSync } from "node:fs";

function git(
  cwd: string,
  args: string[],
): { stdout: string; stderr: string; status: number } {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  return { stdout: r.stdout, stderr: r.stderr, status: r.status ?? -1 };
}

function gitOk(cwd: string, args: string[]): string {
  const r = git(cwd, args);
  if (r.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed in ${cwd}:\n${r.stderr || r.stdout}`,
    );
  }
  return r.stdout.trim();
}

/**
 * Submodule pointer reader. The pinned SHA is the commit ID stored in the
 * project repo's tree at the submodule path — separate from the submodule's
 * own HEAD, which can race ahead during scrape runs.
 *
 * Returns null if the project has no commits yet (fresh init).
 */
export function getPinnedSha(projectRepo: string, submodulePath: string): string | null {
  const head = git(projectRepo, ["rev-parse", "--verify", "HEAD"]);
  if (head.status !== 0) return null;
  const out = gitOk(projectRepo, ["ls-tree", "HEAD", submodulePath]);
  if (out === "") return null;
  // Format: <mode> <type> <sha>\t<path>
  const parts = out.split(/\s+/);
  // Submodules show up as type "commit"; verify defensively.
  if (parts[1] !== "commit") return null;
  return parts[2] ?? null;
}

/** Current HEAD SHA of the submodule's own working repo. */
export function getScrapeHeadSha(scrapeRepo: string): string {
  return gitOk(scrapeRepo, ["rev-parse", "HEAD"]);
}

/**
 * Files changed in `scrapeRepo` between `pinnedSha` (exclusive) and HEAD
 * (inclusive). If `pinnedSha` is null, returns every committed file at HEAD
 * (so a fresh scrape after init shows the full set as "changed").
 */
export function changedFilesSincePin(
  scrapeRepo: string,
  pinnedSha: string | null,
): string[] {
  if (pinnedSha === null) {
    const out = gitOk(scrapeRepo, ["ls-tree", "-r", "--name-only", "HEAD"]);
    return out === "" ? [] : out.split("\n");
  }
  const out = gitOk(scrapeRepo, ["diff", "--name-only", `${pinnedSha}..HEAD`]);
  return out === "" ? [] : out.split("\n");
}

/**
 * Bump the project's submodule pointer to the scrape repo's current HEAD.
 * Returns the new pinned SHA and a flag indicating whether anything changed.
 */
export function repin(
  projectRepo: string,
  submodulePath: string,
  scrapeRepo: string,
): { sha: string; changed: boolean } {
  const newSha = getScrapeHeadSha(scrapeRepo);
  const oldSha = getPinnedSha(projectRepo, submodulePath);
  if (oldSha === newSha) return { sha: newSha, changed: false };

  // Two scrape-repo working trees coexist by design:
  //   - <scrapeRepo>: the canonical sibling, written to by `specs scrape`.
  //     This is what `getScrapeHeadSha` reads.
  //   - <projectRepo>/<submodulePath>: the submodule's clone, what `git add`
  //     in the project queries to determine the new pinned SHA.
  //
  // Sync the submodule clone to the sibling's HEAD before staging. Use
  // `git fetch <sibling-path> <newSha>` so the new commit is reachable, then
  // `git checkout <newSha>` to advance the submodule's HEAD.
  const submoduleClone = resolve(projectRepo, submodulePath);
  if (!existsSync(join(submoduleClone, ".git"))) {
    // First-ever repin or fresh clone of the project — populate the submodule.
    gitOk(projectRepo, [
      "-c",
      "protocol.file.allow=always",
      "submodule",
      "update",
      "--init",
      "--",
      submodulePath,
    ]);
  }
  gitOk(submoduleClone, [
    "-c",
    "protocol.file.allow=always",
    "fetch",
    "-q",
    scrapeRepo,
    newSha,
  ]);
  gitOk(submoduleClone, ["checkout", "-q", newSha]);
  gitOk(projectRepo, ["add", submodulePath]);
  gitOk(projectRepo, [
    "-c",
    "user.email=specs-engine@local",
    "-c",
    "user.name=specs-engine",
    "commit",
    "-q",
    "-m",
    `repin: ${newSha.slice(0, 7)}`,
  ]);
  return { sha: newSha, changed: true };
}
