# skinnycoder

```text
  ____  _  _______ _   _ _   ___   ______ ___  ____  _____ ____  
 / ___|| |/ /_   _| \ | | \ | \ \ / / ___/ _ \|  _ \| ____|  _ \ 
 \___ \| ' /  | | |  \| |  \| |\ V / |  | | | | | | |  _| | |_) |
  ___) | . \  | | | |\  | |\  | | || |__| |_| | |_| | |___|  _ < 
 |____/|_|\_\ |_| |_| \_|_| \_| |_| \____\___/|____/|_____|_| \_\
```

SkinnyCoder is a bare minimum coding harness that can be extended as needed.

It is a lean TypeScript CLI with an 80s amber terminal style. It delegates model calls to the installed `codex` CLI first, so users can reuse their Codex login/subscription. API key provider support can be added later without changing the local tool loop.

View the single-file demo page: [skinnycoder.html](./skinnycoder.html)

## What It Does

- Starts an amber command-line coding session.
- Keeps multiline terminal pastes together as one request.
- Uses `codex exec` as the first provider.
- Keeps context small and local.
- Asks approval before edits and shell commands.
- Shows file diffs before applying changes.
- Can preview and approve a related multi-file patch as one atomic write.
- Tracks SkinnyCoder changes for `/changes` and `/undo`.
- Can install and run allowlisted BrainIT workflows with `/start-an-app` and `/security-scanner`.
- Checkpoints long skill workflows and resumes them without repeating approvals.
- Includes a smoke test for the basic CLI flow.

## Why It Starts Lean

SkinnyCoder stays small because it does not try to replace Codex, index the whole project, or load a large agent framework at startup.

The CLI only boots a local TypeScript command loop, prints the terminal UI, and waits for input. When the user asks for model help, SkinnyCoder delegates reasoning to the installed `codex` CLI with `codex exec`, which reuses the user's existing Codex login/subscription.

The local app owns only the minimum coding harness:

- slash commands
- file reads and writes
- diff previews
- approval prompts
- shell command approval
- change tracking and undo
- small retained context

It also asks Codex for one compact JSON action at a time instead of sending a large tool framework or full repository context. Read/list actions are cheap and automatic; edits and shell commands stay local and require approval.

That is the "skinny" part: Codex provides the model brain, while SkinnyCoder provides the smallest useful terminal harness around it.

## Requirements

- Node.js 20+
- npm
- Codex CLI installed and logged in

Check Codex login:

```bash
codex login
```

## Install

### npm registry package

After the package has been bootstrapped on npm, install the immutable published
release from the registry:

```bash
npm install -g skinnycoder
```

This does not clone the GitHub repository or link a mutable working tree. Until
the one-time npm bootstrap described under [Trusted npm releases](#trusted-npm-releases)
is complete, use the source-checkout method below.

### GitHub source checkout

Clone the repository when you want the current GitHub source or plan to
contribute:

```bash
git clone https://github.com/brainit-consulting/skinnycoder.git
cd skinnycoder
npm ci
npm run build
npm link
```

`npm link` is a one-time setup that registers the local CLI globally. After it
completes, launch SkinnyCoder from any terminal by typing:

```bash
skinnycoder
```

To launch it against a particular project:

```bash
skinnycoder --cwd ./path/to/project
```

Because the global command points to this repository's compiled output, rebuild
after changing the TypeScript source:

```bash
npm run build
```

## Development

Run directly from the TypeScript source while developing:

```bash
npm install
npm run dev
```

Run the existing compiled build without installing the global command:

```bash
npm start
```

Build or refresh `dist`:

```bash
npm run build
```

Full release test suite:

```bash
npm test
```

Focused scripts remain available as `test:interaction`, `test:workflow`,
`test:patch`, `test:provider`, `test:review`, `test:skills`, and `test:smoke`.

## Trusted npm releases

npm releases are prepared on `main` and published only by
[`.github/workflows/publish-npm.yml`](./.github/workflows/publish-npm.yml). The
workflow runs on a pushed `vX.Y.Z` tag, requires the tag to exactly match
`package.json`, and refuses a tagged commit that is not contained in
`origin/main`. On a GitHub-hosted runner it uses Node.js 24 and an npm version
compatible with trusted publishing, then runs `npm ci`, the build, the full test
suite, and packaging without OIDC permission. A separate minimal publish job
downloads that verified tarball and runs `npm publish --ignore-scripts --access
public` with OIDC permission.

Only the final publish job has `id-token: write`, and it disables package
lifecycle scripts while that permission is available. The workflow has no
`NPM_TOKEN` or other long-lived registry credential. npm automatically adds
provenance for a public package published from this public GitHub repository
through trusted publishing.

For each release, update the version and both documentation surfaces, commit
and push the verified change to `main`, then create and push the matching tag:

```bash
git tag -a vX.Y.Z -m "Release SkinnyCoder vX.Y.Z"
git push origin vX.Y.Z
```

### One-time npm owner setup

The `skinnycoder` package does not yet exist on npm, and npm only permits a
trusted publisher to be attached to an existing package. An npm owner must
therefore complete one bootstrap setup: authenticate with 2FA, manually publish
the first reviewed unique version as a public package, then open that package's
Settings → Trusted publishing and add GitHub Actions with these exact values:

- Organization or user: `brainit-consulting`
- Repository: `skinnycoder`
- Workflow filename: `publish-npm.yml`
- Environment: leave blank
- Allowed action: `npm publish`

After the first OIDC release succeeds, npm recommends setting publishing access
to require 2FA and disallow tokens. Normal later releases need only the verified
version commit and matching tag; contributors never need an npm write token.

## Usage

```bash
skinnycoder
skinnycoder --cwd ./project
skinnycoder --model gpt-5
skinnycoder --reasoning medium
skinnycoder --version
skinnycoder --no-logo
```

On startup, type:

```text
/help
```

### Codex CLI update check

In an interactive terminal, SkinnyCoder checks the installed Codex CLI against
the current npm release at startup. If an update is available, it shows the
installed and latest versions and asks before running:

```bash
npm install -g @openai/codex@latest
```

SkinnyCoder never updates global packages without approval. If the npm registry
is unavailable, it continues with the installed Codex CLI. To skip the check:

```bash
skinnycoder --no-update-check
```

## Slash Commands

```text
/help              Show commands
/about             Open the local SkinnyCoder v0.2.2 page
/login             Run Codex login
/model [name]      Show or override the Codex model for this session
/model default     Return to the model selected by Codex configuration
/reasoning [level] Show or override reasoning for this session
/reasoning default Return to reasoning selected by Codex configuration
/status            Show cwd, model, active skill, scope, and change count
/context           Show retained context and last Codex token usage
/skills            Show trusted BrainIT skill installation and workflow status
/skills stop       Stop the active skill workflow
/continue          Resume the active skill from its latest checkpoint
/start-an-app [idea]
                   Interview, agree a build sheet, and scaffold a new app
/security-scanner  Run an OWASP Top 10:2025 audit workflow
/scope [paths]     Limit file operations to one or more paths
/scope clear       Restore the whole working directory as the file scope
/files [path]      List files
/read <file> [--from N] [--lines N]
                   Read up to 400 lines and print an exact continuation command
/edit <file> <instruction>
                   Make a focused edit; missing targets can be created
/run <command>     Preview, approve, and run a local shell command
/web <query>       Run an isolated web search with source links
/review            Review scoped uncommitted changes
/diff              Show git diff
/changes           Show files changed by SkinnyCoder
/undo              Undo the last SkinnyCoder file change
/clear             Clear retained conversation turns
/exit              Quit
```

`/about` opens the packaged [SkinnyCoder demo page](./skinnycoder.html) in the
operating system's default browser. It runs locally without a model call and
does not add anything to conversation context.

Multiline text pasted at the main prompt is submitted as one request. It is not
queued as several later prompts. `/edit` also retains structured edit intent,
so wording such as `keep the file read-only` cannot accidentally turn an edit
into a display-only request. Quote target paths that contain spaces.

Read large files in bounded pages:

```text
/read README.md
/read README.md --from 201 --lines 100
/read "docs/long file.md" --from 401 --lines 200
```

When more content remains, SkinnyCoder prints the exact command for the next
page. Planner `read_file` actions use the same 1-based line paging and never
silently hide the remainder.

## Run, scope, and web search

Run routine local commands directly without spending a model call or adding the
command output to conversation context:

```text
/run npm test
/run git status
/run rg "CodexProvider" src
```

SkinnyCoder previews the command and requires approval before execution. The
result reports success or failure, the exit code, stdout, and stderr separately;
combined displayed output remains bounded. On Windows the planner is told that
commands run in PowerShell and is warned not to overwrite automatic variables
such as `$HOME`. Shell commands are not constrained by `/scope`, so review each
command before approving it.

Limit file listings, reads, model-proposed edits, and `/diff` to relevant paths:

```text
/scope src
/scope src/cli.ts src/slash.ts
/scope
/scope clear
```

Scope stores only path names in context; it never preloads file contents or
builds an index. Paths containing spaces can be quoted. Attempts to use local
file tools outside the active scope are rejected.

Run a current, one-shot web search through Codex:

```text
/web current Node.js LTS release
/web official TypeScript NodeNext documentation
```

Web searches use an ephemeral `codex exec --search` call and request a concise
answer with direct source links. Neither the query, raw search activity, nor the
answer is added to SkinnyCoder's retained conversation context.

## Review changes

Review staged, unstaged, and readable untracked changes within the active
`/scope`:

```text
/review
```

SkinnyCoder assembles and caps the Git diff locally, then sends only that diff
to an ephemeral, read-only Codex call. Findings are ordered by severity and
include file and line references when available. Binary files, symbolic links,
and other non-regular files are represented only by filename notes. Neither the
diff nor findings are retained in the conversation, and `/review` never applies
fixes automatically. To keep startup bounded, at most 500 untracked entries are
included in one review.

## Grouped edits and undo

For changes spanning two or more related files, the planner can return one
`patch_files` action containing only `create_file`, `replace_in_file`, and
`append_file` operations. SkinnyCoder validates every path and replacement,
shows one combined diff, and asks once before writing. Shell commands can never
be included and still require separate approval.

Grouped writes are applied as one unit. A write failure rolls back files already
written, and `/undo` reverses the entire group. Undo refuses to overwrite a file
that changed after SkinnyCoder wrote it. Ambiguous replacement text is rejected
instead of changing an arbitrary occurrence, and oversized grouped previews
must be split into smaller reviewable patches. Local file tools also reject any
path that traverses a symbolic link or Windows junction.

## Trusted skill workflows

SkinnyCoder v0.2.2 includes two allowlisted workflow commands from
[BrainIT Consulting's DreamForge agent skills](https://github.com/brainit-consulting/DreamForgeSoftwareAgentSkills):

```text
/start-an-app
/start-an-app a booking system for my salon
/security-scanner
/skills
/skills stop
```

`/start-an-app` is intended for a new or empty working folder. It interviews
the user one topic at a time, reads the proposed build sheet back, and waits for
approval before scaffolding. If SkinnyCoder detects an existing project marker
such as `package.json` or `src/`, it stops rather than merging a new scaffold
into that project.

`/security-scanner` applies the OWASP Top 10:2025 workflow to the current
project. Reconnaissance stays read-only; cloning a target, running a command, or
writing the final report still passes through SkinnyCoder's existing approval
flow.

On first use, SkinnyCoder checks the active provider's global skill directory.
If the trusted skill is missing or its recorded source cannot be verified, it
shows the exact install command and asks before running it. For Codex the
equivalent command is:

```bash
npx --yes skills@1.5.21 add brainit-consulting/DreamForgeSoftwareAgentSkills --skill start-an-app --global --agent codex --yes
```

The installer runs with anonymous Skills CLI telemetry disabled. Skill installs
never happen during ordinary startup. SkinnyCoder accepts installations from
the published DreamForge repository and the maintained
[`brainit-consulting/skills`](https://github.com/brainit-consulting/skills)
source fork.

An active workflow is named in `/status` and `/context`. SkinnyCoder explicitly
reloads that skill for each fresh planner call while retaining only its normal
four recent turns plus a capped 3,000-character workflow state containing
confirmed requirements, decisions, approvals, current phase, and pending
action. Nonblocking progress continues automatically; an actual question pauses
for input. Tool actions refresh both the model summary and a content-free local
last-action checkpoint, and `/continue` resumes after
the 24-action safety boundary without repeating confirmed decisions. Before a
workflow can finish with `complete_skill`, it must verify required files and run
the project's configured lint/build checks when available. The user can leave a
workflow with `/skills stop`. Skill instructions never override the active cwd,
`/scope`, diff preview, or approval rules.

## Model selection

SkinnyCoder shows the effective Codex model and its source at startup. Use
`/model` at any time to inspect it:

```text
/model
```

Override the model for the current SkinnyCoder session, or return to the model
from Codex's user/project `config.toml`:

```text
/model gpt-5.6-terra
/model default
```

The `--model <name>` launch option has the same effect as an initial session
override. SkinnyCoder also includes the effective model ID in each planner
request, so it can answer questions about which model it is using.

## Reasoning effort

SkinnyCoder inherits `model_reasoning_effort` from Codex configuration and
shows the effective level at startup. Inspect or override it for the current
session with:

```text
/reasoning
/reasoning medium
/reasoning high
/reasoning default
```

Supported values are `low`, `medium`, `high`, `xhigh`, `max`, and `ultra`.
The launch option `--reasoning <level>` creates the same session-level override.
SkinnyCoder passes the override to normal planner calls and `/web` searches but
does not change the user's global Codex configuration. Higher levels can take
longer and use more reasoning tokens; `ultra` may use subagents.

The application version comes from `package.json`, appears at startup, and is
also available without launching a session:

```bash
skinnycoder --version
```

## Safety Model

SkinnyCoder runs read-only tool calls automatically:

- `list_files`
- `read_file`

These actions require approval:

- `create_file`
- `replace_in_file`
- `append_file`
- `patch_files` (2-20 related file operations, one combined approval)
- `run_command`

The model proposes one compact JSON action at a time. A `patch_files` action can
group related file operations, but it remains one bounded, fully previewed,
atomic action. SkinnyCoder owns local file writes, shell execution, approval,
change tracking, and undo. Trusted skill workflows use the same action and
approval boundary.

## Context

Use:

```text
/context
```

This shows the local retained context estimate and, after a model call, the last Codex-reported token usage.

## Current Scope

This is intentionally small. It is not trying to be a full IDE, a general skill marketplace, or a long-context project indexer. The goal is a simple, inspectable coding loop that grows through explicit, allowlisted workflows where they add clear value.
