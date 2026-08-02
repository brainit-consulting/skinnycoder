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
- Uses `codex exec` as the first provider.
- Keeps context small and local.
- Asks approval before edits and shell commands.
- Shows file diffs before applying changes.
- Tracks SkinnyCoder changes for `/changes` and `/undo`.
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

From npm, once published:

```bash
npm install -g skinnycoder
```

From this repo:

```bash
npm install
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

Smoke test:

```bash
npm run test:smoke
```

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
/about             Open the local SkinnyCoder v0.1.0 page
/login             Run Codex login
/model [name]      Show or override the Codex model for this session
/model default     Return to the model selected by Codex configuration
/reasoning [level] Show or override reasoning for this session
/reasoning default Return to reasoning selected by Codex configuration
/status            Show cwd, model, and change count
/context           Show retained context and last Codex token usage
/scope [paths]     Limit file operations to one or more paths
/scope clear       Restore the whole working directory as the file scope
/files [path]      List files
/read <file>       Read a capped file preview
/edit <file> <instruction>
                   Ask Codex to edit a file, then preview and approve the change
/run <command>     Preview, approve, and run a local shell command
/web <query>       Run an isolated web search with source links
/diff              Show git diff
/changes           Show files changed by SkinnyCoder
/undo              Undo the last SkinnyCoder file change
/clear             Clear retained conversation turns
/exit              Quit
```

`/about` opens the packaged [SkinnyCoder demo page](./skinnycoder.html) in the
operating system's default browser. It runs locally without a model call and
does not add anything to conversation context.

## Run, scope, and web search

Run routine local commands directly without spending a model call or adding the
command output to conversation context:

```text
/run npm test
/run git status
/run rg "CodexProvider" src
```

SkinnyCoder previews the command and requires approval before execution. Output
is capped at 12,000 characters. Shell commands are not constrained by `/scope`,
so review each command before approving it.

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
- `run_command`

The model proposes one compact JSON action at a time. SkinnyCoder owns local file writes, shell execution, approval, change tracking, and undo.

## Context

Use:

```text
/context
```

This shows the local retained context estimate and, after a model call, the last Codex-reported token usage.

## Current Scope

This is intentionally small. It is not trying to be a full IDE, plugin framework, or long-context project indexer. The goal is a simple, inspectable coding loop that can grow only where needed.
