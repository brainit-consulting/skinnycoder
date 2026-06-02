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

Then run:

```bash
skinnycoder
```

## Development

```bash
npm install
npm run dev
```

Build:

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
skinnycoder --no-logo
```

On startup, type:

```text
/help
```

## Slash Commands

```text
/help              Show commands
/login             Run Codex login
/model [name]      Show or set the Codex model
/status            Show cwd, model, and change count
/context           Show retained context and last Codex token usage
/files [path]      List files
/read <file>       Read a capped file preview
/edit <file> <instruction>
                   Ask Codex to edit a file, then preview and approve the change
/diff              Show git diff
/changes           Show files changed by SkinnyCoder
/undo              Undo the last SkinnyCoder file change
/clear             Clear retained conversation turns
/exit              Quit
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
