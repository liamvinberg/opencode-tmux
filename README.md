# opencode-tmux

Tmux integration plugin for OpenCode. Automatically injects tmux session context and provides tools for interacting with tmux panes.

## Features

- **Auto-inject context** - On session start and compaction, injects current tmux session info
- **Server detection** - Automatically identifies running dev servers (bun, node, docker, etc.)
- **Error highlighting** - Flags error patterns when reading logs
- **Tools for interaction** - Read logs, restart servers, send commands, list sessions

## Installation

### npm (recommended)

```bash
# Add to your opencode.json
{
  "plugin": ["opencode-tmux"]
}
```

### Local development

```bash
# Clone and install
git clone https://github.com/liamvinberg/opencode-tmux
cd opencode-tmux
bun install

# Add to your opencode.json for testing
{
  "plugin": ["file:///path/to/opencode-tmux/index.ts"]
}
```

## Auto-injected Context

When running inside a tmux session, the plugin automatically injects context like:

```markdown
## tmux Context
**Session:** my-project

**Windows:**
1. nvim - nvim
2. cmd - zsh
3. run - bun

**Running Servers:**
- Window 3 (run): bun (path: /Users/me/project)

**Available tmux tools:** tmux_read_logs, tmux_restart_server, tmux_send_command, tmux_list
```

## Tools

### tmux_read_logs

Read the last N lines of output from a tmux pane. Error patterns are highlighted.

```
tmux_read_logs(window: 3, lines: 100)
```

**Arguments:**
- `session` (optional) - Tmux session name. Defaults to current session.
- `window` (required) - Window index (1-based)
- `pane` (optional) - Pane index. Defaults to 0.
- `lines` (optional) - Number of lines to capture. Defaults to 50.

### tmux_restart_server

Restart a server by sending Ctrl-C and then running the specified command.

```
tmux_restart_server(window: 3, command: "bun dev")
```

**Arguments:**
- `session` (optional) - Tmux session name
- `window` (required) - Window index (1-based)
- `pane` (optional) - Pane index. Defaults to 0.
- `command` (optional) - Command to run after stopping. Defaults to "bun dev".

### tmux_send_command

Send any command to a tmux pane.

```
tmux_send_command(window: 2, command: "git status")
```

**Arguments:**
- `session` (optional) - Tmux session name
- `window` (required) - Window index (1-based)
- `pane` (optional) - Pane index. Defaults to 0.
- `command` (required) - Command to send
- `enter` (optional) - Whether to press Enter. Defaults to true.

### tmux_list

List tmux sessions, windows, and panes.

```
tmux_list(scope: "all", servers_only: true)
```

**Arguments:**
- `scope` (optional) - "current" or "all". Defaults to "current".
- `servers_only` (optional) - Only show server processes. Defaults to false.

## Server Process Detection

The following processes are recognized as "servers":

- **JS/TS:** bun, node, npm, pnpm, yarn
- **Python:** python, python3, uvicorn, gunicorn, flask, django
- **Container:** docker, docker-compose, ngrok
- **Rust:** cargo, rustc
- **Go:** go
- **Ruby:** ruby, rails
- **Java:** java, gradle, mvn
- **Other:** php, dotnet, nginx, apache, redis-server, postgres, mysql, mongod

## Error Pattern Detection

The following patterns are flagged when reading logs:

- `error`, `failed`, `exception`, `fatal`, `panic`
- `cannot`, `undefined`, `not found`
- `ENOENT`, `EACCES`, `ECONNREFUSED`
- `TypeError`, `ReferenceError`, `SyntaxError`

## Requirements

- tmux installed and in PATH
- Running inside a tmux session (for auto-context injection)
- OpenCode 1.0+

## Graceful Degradation

- If tmux is not installed, plugin is disabled silently
- If not in a tmux session, auto-context is disabled but tools remain available
- Tools return helpful error messages when targets are invalid

## License

MIT
