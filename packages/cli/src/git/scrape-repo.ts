import { spawnSync } from "node:child_process";

/** `git -C <cwd> <args...>` with consistent error reporting. */
function git(cwd: string, args: string[]): { stdout: string; stderr: string } {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed in ${cwd}:\n${r.stderr || r.stdout}`);
  }
  return { stdout: r.stdout, stderr: r.stderr };
}

/**
 * Stage every file under the scrape repo and commit if there is a diff.
 * Returns the new commit SHA, or null if nothing changed (idempotent re-run).
 *
 * Uses `git status --porcelain` to detect dirtiness rather than relying on
 * `git commit --allow-empty` so re-runs leave the log clean.
 */
export function commitIfDirty(scrapeRepo: string, message: string): string | null {
  git(scrapeRepo, ["add", "-A"]);
  const status = git(scrapeRepo, ["status", "--porcelain"]).stdout.trim();
  if (status === "") return null;
  git(scrapeRepo, [
    "-c",
    "user.email=specs-engine@local",
    "-c",
    "user.name=specs-engine",
    "commit",
    "-q",
    "-m",
    message,
  ]);
  const sha = git(scrapeRepo, ["rev-parse", "HEAD"]).stdout.trim();
  return sha;
}

/** Current HEAD SHA of `repo`. */
export function headSha(repo: string): string {
  return git(repo, ["rev-parse", "HEAD"]).stdout.trim();
}
