# Set up Rollcage in this repository (instructions for an AI coding agent)

You were pointed at this page to add the Rollcage guardrails to the repository you are working in.
Follow the steps in order. Stop and ask the human where the page says to. The whole job is a pull
request with new files in it. It changes no settings and calls no cloud.

## What you will add

Four GitHub Actions guardrails, as new files only:

| Check               | What it does                                                           |
| ------------------- | ---------------------------------------------------------------------- |
| `risk-gate / gate`  | Scores each pull request for risk and comments. Starts in observe mode. |
| `secrets / gitleaks`| Scans for committed secrets.                                           |
| `sbom / sbom`       | Lists dependencies, scans them, and fails on a critical, exploited CVE. |
| `policy / policy`   | Runs policy as code on Terraform plan JSON and workflow files.         |

Files created: `.github/workflows/rollcage.yml`, one `.github/workflows/rollcage-*.yml` per check,
and `risk-gate.yml`. Existing files are never overwritten.

## Steps

1. **Check the ground.** You need `git`, Node 24 or newer, and `pnpm`. Run `git status`; the working
   tree should be clean and you should be at the repository root. If a tool is missing, tell the
   human what to install. Do not install system packages without asking.
2. **Branch.** `git switch -c chore/add-rollcage`.
3. **Pick a ref.** Ask the human which Rollcage release to pin, or use the latest tag from
   `git ls-remote --tags https://github.com/frankTurtle/rollcage.git`. The installer pins the
   workflows to the exact commit it fetched.
4. **Preview.** Run a dry run and show the human its output:

   ```bash
   curl -fsSL https://raw.githubusercontent.com/frankTurtle/rollcage/<ref>/install.sh | bash -s -- --dry-run
   ```

   If you cannot pipe to a shell, download `install.sh`, read it, and run `bash install.sh --dry-run`.
5. **Install.** Run the same command without `--dry-run`. Options: `--pieces risk-gate,secrets,sbom,policy`
   (a comma list; `provenance` is also available but needs a build artifact, so leave it out unless
   the human asks), `--extras --owner <github-login>` to also add CODEOWNERS, Dependabot, SECURITY.md
   and a PR template.
6. **Review.** Read the generated files. Confirm every `uses: frankTurtle/rollcage/...` line ends in
   a 40-character commit SHA and every third-party action is pinned to a SHA.
7. **Commit.** `git add .github risk-gate.yml && git commit -m "chore: add rollcage guardrails"`.
   Do not push or open the pull request until the human says so, then open it against the default
   branch.
8. **Tell the human what is left** (you cannot do these):
   - After the first pull request has run, require these checks on the default branch:
     `risk-gate / gate`, `secrets / gitleaks`, `sbom / sbom`, `policy / policy`. Copy the exact names
     from the Checks tab. Branch protection is what makes the checks binding.
   - Organizations need a `GITLEAKS_LICENSE` secret for the secrets scan. Personal accounts do not.
   - The risk gate starts in `mode: observe` in `risk-gate.yml`. Switch it to `enforce` once the
     scores look right.

## Rules for you

- Never overwrite or delete an existing file. If the installer reports `already exists`, leave it
  and tell the human.
- Never put a secret, token or API key in any file or message.
- Do not change repository settings, branch protection or secrets, and do not run `terraform apply`
  or any deploy.
- Do not run the provenance workflow in `attest` mode: it writes a public entry to a transparency
  log.
- If anything fails, stop and report the exact error. Do not work around a failing check by
  weakening it.

## Check it worked

The first pull request should show the four checks. The risk gate should post a comment. The
`sbom / sbom` check needs a lockfile or manifest it recognizes. Where the scan finds nothing it
passes. If a check is missing, run the `check` and `init --dry-run` commands from the
[golden path piece](../pieces/12-golden-path-template/README.md) and compare.
