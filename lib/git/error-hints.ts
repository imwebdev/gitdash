// Translates raw git/gh failure output into a single plain-English hint.
// The goal is that the modal always ends with something a non-power-user can act on.
// Patterns are matched bottom-up because the actual error is almost always near the end.

export interface ErrorHint {
  hint: string;
  matchedLine: string;
}

interface Pattern {
  test: RegExp;
  hint: string;
}

const PATTERNS: readonly Pattern[] = [
  {
    test: /Password authentication is not supported|Authentication failed for 'https:\/\/[^']*github\.com|Invalid username or token/i,
    hint:
      "Your saved GitHub login is missing or out of date.\n" +
      "Fix: open a terminal and run  gh auth setup-git  (install the GitHub CLI from https://cli.github.com if you don't have it).",
  },
  {
    test: /Permission denied \(publickey\)|Could not read from remote repository/i,
    hint:
      "GitHub didn't accept your SSH key.\n" +
      "Fix: run  gh auth setup-git --force , or add an SSH key to your GitHub account at https://github.com/settings/keys",
  },
  {
    test: /Could not resolve host|Connection refused|Connection timed out|Network is unreachable|Temporary failure in name resolution/i,
    hint: "Can't reach GitHub right now. Check your internet connection and try again.",
  },
  {
    test: /Updates were rejected because the remote contains work|non-fast-forward|tip of your current branch is behind/i,
    hint:
      "Someone else pushed to this branch first.\n" +
      "Fix: click Pull (or run  git pull --rebase ), resolve any conflicts, then push again.",
  },
  {
    test: /has no upstream branch|set the remote as upstream|--set-upstream/i,
    hint:
      "This branch isn't tracking a remote yet.\n" +
      "Fix: open a terminal in the repo and run  git push -u origin HEAD",
  },
  {
    test: /pre-receive hook declined|protected branch hook declined|GH006|GH013|cannot lock ref/i,
    hint:
      "GitHub blocked this push (likely a protected branch or repo rule).\n" +
      "Fix: open a Pull Request from a feature branch instead, or check the branch protection settings.",
  },
  {
    test: /(Repository|repository) not found|ERROR: Repository not found/i,
    hint:
      "GitHub couldn't find this repository.\n" +
      "Fix: check the remote URL is correct and that your account has access.",
  },
  {
    test: /(your local changes|untracked working tree files) would be overwritten/i,
    hint:
      "You have local edits that this would overwrite.\n" +
      "Fix: commit or stash your changes first, then try again.",
  },
  {
    test: /^CONFLICT |Automatic merge failed|fix conflicts and then commit/im,
    hint:
      "There are merge conflicts to resolve.\n" +
      "Fix: open the repo in your editor, resolve the conflicted files, commit, and try again.",
  },
  {
    test: /refusing to merge unrelated histories/i,
    hint: "These two branches don't share history. You're probably pulling from the wrong remote or branch.",
  },
  {
    test: /src refspec .* does not match any|does not match any\.?$/i,
    hint: "There's nothing on this branch to push yet. Make a commit first.",
  },
  {
    test: /not a git repository/i,
    hint: "This folder isn't a git repository (or its .git was removed).",
  },
  {
    test: /file too large|exceeds GitHub's file size limit|GH001/i,
    hint:
      "A file in this push is too big for GitHub (>100 MB).\n" +
      "Fix: remove the large file from the commit, or set up Git LFS (https://git-lfs.com).",
  },
  {
    test: /pathspec .* did not match any file|did not match any files/i,
    hint: "Git couldn't find one of the files referenced. It may have been moved or deleted.",
  },
  {
    test: /Your branch and 'origin\/.*' have diverged/i,
    hint:
      "Your branch and the remote have both moved.\n" +
      "Fix: pull with rebase to replay your commits on top  ( git pull --rebase ), then push.",
  },
];

export function translateGitError(lines: readonly string[]): ErrorHint | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line) continue;
    for (const p of PATTERNS) {
      if (p.test.test(line)) {
        return { hint: p.hint, matchedLine: line };
      }
    }
  }
  return null;
}

export function friendlyStepLabel(label: string): string {
  switch (label) {
    case "stage":
      return "Staging changes";
    case "commit":
      return "Creating commit";
    case "push":
      return "Pushing to GitHub";
    default:
      return label;
  }
}
