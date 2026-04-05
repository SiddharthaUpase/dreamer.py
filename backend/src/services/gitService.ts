import type { SandboxInstance } from "@blaxel/core";

const DEFAULT_WORKING_DIR = "/app";

/** Run a command in the sandbox and return stdout trimmed */
async function exec(sandbox: SandboxInstance, command: string, workingDir: string): Promise<string> {
  const result = await sandbox.process.exec({ command, workingDir, waitForCompletion: true });
  return (result.stdout || "").trim();
}

/** Check if a git repo is already initialized */
export async function isGitInitialized(sandbox: SandboxInstance, workingDir = DEFAULT_WORKING_DIR): Promise<boolean> {
  try {
    const result = await exec(sandbox, "test -d .git && echo yes || echo no", workingDir);
    return result === "yes";
  } catch {
    return false;
  }
}

/** Initialize a git repo with branch name 'main', configure user, and create initial commit */
export async function initRepo(sandbox: SandboxInstance, workingDir = DEFAULT_WORKING_DIR): Promise<string> {
  // Ensure .gitignore covers large dirs before first commit
  await exec(
    sandbox,
    `if [ ! -f .gitignore ]; then echo -e "node_modules/\\n.next/" > .gitignore; else grep -qxF "node_modules/" .gitignore || echo "node_modules/" >> .gitignore; grep -qxF ".next/" .gitignore || echo ".next/" >> .gitignore; fi`,
    workingDir,
  );

  await exec(sandbox, "git init -b main", workingDir);
  await exec(sandbox, 'git config user.email "dreamer@agent-vas.dev"', workingDir);
  await exec(sandbox, 'git config user.name "Dreamer"', workingDir);
  await exec(sandbox, "git add -A", workingDir);
  await exec(sandbox, 'git commit -m "Initial template"', workingDir);

  return exec(sandbox, "git rev-parse HEAD", workingDir);
}

/** Stage all changes and commit if there are any. Returns SHA or null if nothing changed. */
export async function commitChanges(sandbox: SandboxInstance, message: string, workingDir = DEFAULT_WORKING_DIR): Promise<string | null> {
  await exec(sandbox, "git add -A", workingDir);

  const status = await exec(sandbox, "git status --porcelain", workingDir);
  if (!status) return null; // nothing to commit

  await exec(sandbox, `git commit -m ${JSON.stringify(message)}`, workingDir);
  return exec(sandbox, "git rev-parse HEAD", workingDir);
}

/** Get the current HEAD SHA */
export async function getHeadSha(sandbox: SandboxInstance, workingDir = DEFAULT_WORKING_DIR): Promise<string | null> {
  try {
    return await exec(sandbox, "git rev-parse HEAD", workingDir) || null;
  } catch {
    return null;
  }
}

/** Hard reset to a specific commit */
export async function resetToCommit(sandbox: SandboxInstance, sha: string, workingDir = DEFAULT_WORKING_DIR): Promise<void> {
  await exec(sandbox, `git reset --hard ${sha}`, workingDir);
}
