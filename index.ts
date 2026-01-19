import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"

const SERVER_PROCESSES = new Set([
  "bun",
  "node",
  "npm",
  "pnpm",
  "yarn",
  "docker",
  "docker-compose",
  "ngrok",
  "python",
  "python3",
  "uvicorn",
  "gunicorn",
  "flask",
  "django",
  "cargo",
  "rustc",
  "go",
  "ruby",
  "rails",
  "php",
  "java",
  "gradle",
  "mvn",
  "dotnet",
  "nginx",
  "apache",
  "redis-server",
  "postgres",
  "mysql",
  "mongod",
])

const ERROR_PATTERNS = [
  /error/i,
  /failed/i,
  /exception/i,
  /fatal/i,
  /panic/i,
  /cannot/i,
  /undefined/i,
  /not found/i,
  /ENOENT/,
  /EACCES/,
  /ECONNREFUSED/,
  /TypeError/,
  /ReferenceError/,
  /SyntaxError/,
]

interface TmuxPane {
  session: string
  window: number
  pane: number
  command: string
  path: string
  windowName?: string
}

interface TmuxWindow {
  index: number
  name: string
  panes: TmuxPane[]
}

interface TmuxSession {
  name: string
  windows: TmuxWindow[]
}

async function isTmuxAvailable($: any): Promise<boolean> {
  try {
    await $`which tmux`.quiet()
    return true
  } catch {
    return false
  }
}

async function isInTmuxSession(): Promise<boolean> {
  return !!process.env.TMUX
}

async function getCurrentSession($: any): Promise<string | null> {
  try {
    const result = await $`tmux display-message -p '#S'`.text()
    return result.trim()
  } catch {
    return null
  }
}

async function getPanes($: any, sessionFilter?: string): Promise<TmuxPane[]> {
  try {
    const format = "#{session_name}:#{window_index}.#{pane_index} #{pane_current_command} #{pane_current_path} #{window_name}"
    let result: string
    
    if (sessionFilter) {
      result = await $`tmux list-panes -t ${sessionFilter} -a -F ${format}`.text()
    } else {
      result = await $`tmux list-panes -a -F ${format}`.text()
    }
    
    return result
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const match = line.match(/^(.+):(\d+)\.(\d+)\s+(\S+)\s+(\S+)\s*(.*)$/)
        if (!match) return null
        return {
          session: match[1],
          window: parseInt(match[2], 10),
          pane: parseInt(match[3], 10),
          command: match[4],
          path: match[5],
          windowName: match[6] || undefined,
        } as TmuxPane
      })
      .filter((p): p is TmuxPane => p !== null)
  } catch {
    return []
  }
}

async function getWindows($: any, session: string): Promise<TmuxWindow[]> {
  try {
    const result = await $`tmux list-windows -t ${session} -F '#{window_index}:#{window_name}'`.text()
    const panes = await getPanes($, session)
    
    return result
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line: string) => {
        const [indexStr, name] = line.split(":")
        const index = parseInt(indexStr, 10)
        return {
          index,
          name: name || `window-${index}`,
          panes: panes.filter((p) => p.session === session && p.window === index),
        }
      })
  } catch {
    return []
  }
}

async function getSessions($: any): Promise<TmuxSession[]> {
  try {
    const result = await $`tmux list-sessions -F '#{session_name}'`.text()
    const sessionNames = result.trim().split("\n").filter(Boolean)
    
    const sessions: TmuxSession[] = []
    for (const name of sessionNames) {
      const windows = await getWindows($, name)
      sessions.push({ name, windows })
    }
    return sessions
  } catch {
    return []
  }
}

function isServerProcess(command: string): boolean {
  return SERVER_PROCESSES.has(command)
}

function highlightErrors(text: string): string {
  const lines = text.split("\n")
  const highlighted: string[] = []
  
  for (const line of lines) {
    const hasError = ERROR_PATTERNS.some((pattern) => pattern.test(line))
    if (hasError) {
      highlighted.push(`[ERROR] ${line}`)
    } else {
      highlighted.push(line)
    }
  }
  
  return highlighted.join("\n")
}

function generateTmuxContext(
  currentSession: string,
  windows: TmuxWindow[],
  allPanes: TmuxPane[]
): string {
  const serverPanes = allPanes.filter(
    (p) => p.session === currentSession && isServerProcess(p.command)
  )
  
  let context = `## tmux Context\n`
  context += `**Session:** ${currentSession}\n\n`
  
  context += `**Windows:**\n`
  for (const win of windows) {
    const mainPane = win.panes[0]
    const command = mainPane?.command || "unknown"
    context += `${win.index}. ${win.name} - ${command}\n`
  }
  
  if (serverPanes.length > 0) {
    context += `\n**Running Servers:**\n`
    for (const pane of serverPanes) {
      const win = windows.find((w) => w.index === pane.window)
      const winName = win?.name || `window-${pane.window}`
      context += `- Window ${pane.window} (${winName}): ${pane.command} (path: ${pane.path})\n`
    }
  }
  
  context += `\n**Available tmux tools:** tmux_read_logs, tmux_restart_server, tmux_send_command, tmux_list\n`
  
  return context
}

export const OpencodeTmux: Plugin = async ({ $ }) => {
  const tmuxAvailable = await isTmuxAvailable($)
  const inTmuxSession = await isInTmuxSession()
  
  if (!tmuxAvailable) {
    return {}
  }
  
  const injectContext = async () => {
    if (!inTmuxSession) return
    
    const currentSession = await getCurrentSession($)
    if (!currentSession) return
    
    const windows = await getWindows($, currentSession)
    const panes = await getPanes($, currentSession)
    
    return generateTmuxContext(currentSession, windows, panes)
  }
  
  return {
    event: async ({ event }) => {
      if (event.type === "session.created" || event.type === "session.compacted") {
        await injectContext()
      }
    },
    
    "experimental.session.compacting": async (_input, output) => {
      const context = await injectContext()
      if (context) {
        output.context.push(context)
      }
    },
    
    tool: {
      tmux_read_logs: tool({
        description:
          "Read the last N lines of output from a tmux pane. Useful for checking server logs, errors, and output. Error patterns are automatically highlighted.",
        args: {
          session: tool.schema
            .string()
            .optional()
            .describe("Tmux session name. Defaults to current session."),
          window: tool.schema
            .number()
            .describe("Window index (1-based)"),
          pane: tool.schema
            .number()
            .optional()
            .default(0)
            .describe("Pane index within the window. Defaults to 0."),
          lines: tool.schema
            .number()
            .optional()
            .default(50)
            .describe("Number of lines to capture. Defaults to 50."),
        },
        async execute(args) {
          const session = args.session || (await getCurrentSession($))
          if (!session) {
            return "Error: Could not determine tmux session. Specify session parameter."
          }
          
          const target = `${session}:${args.window}.${args.pane || 0}`
          
          try {
            const result = await $`tmux capture-pane -t ${target} -p -S -${args.lines || 50}`.text()
            const highlighted = highlightErrors(result)
            
            const errorCount = (highlighted.match(/\[ERROR\]/g) || []).length
            let header = `=== Logs from ${target} (last ${args.lines || 50} lines) ===\n`
            if (errorCount > 0) {
              header += `Found ${errorCount} potential error(s)\n`
            }
            header += "---\n"
            
            return header + highlighted
          } catch (error) {
            return `Error reading logs from ${target}: ${error}`
          }
        },
      }),
      
      tmux_restart_server: tool({
        description:
          "Restart a server running in a tmux pane by sending Ctrl-C and then the specified command. If no command is specified, attempts to use the last command.",
        args: {
          session: tool.schema
            .string()
            .optional()
            .describe("Tmux session name. Defaults to current session."),
          window: tool.schema
            .number()
            .describe("Window index (1-based)"),
          pane: tool.schema
            .number()
            .optional()
            .default(0)
            .describe("Pane index within the window. Defaults to 0."),
          command: tool.schema
            .string()
            .optional()
            .describe("Command to run after stopping. If not provided, uses 'bun dev' as default."),
        },
        async execute(args) {
          const session = args.session || (await getCurrentSession($))
          if (!session) {
            return "Error: Could not determine tmux session. Specify session parameter."
          }
          
          const target = `${session}:${args.window}.${args.pane || 0}`
          const restartCmd = args.command || "bun dev"
          
          try {
            await $`tmux send-keys -t ${target} C-c`
            await new Promise((r) => setTimeout(r, 1000))
            await $`tmux send-keys -t ${target} ${restartCmd} Enter`
            
            return `Server in ${target} restarted with command: ${restartCmd}`
          } catch (error) {
            return `Error restarting server in ${target}: ${error}`
          }
        },
      }),
      
      tmux_send_command: tool({
        description:
          "Send a command to a tmux pane. The command will be typed and executed with Enter.",
        args: {
          session: tool.schema
            .string()
            .optional()
            .describe("Tmux session name. Defaults to current session."),
          window: tool.schema
            .number()
            .describe("Window index (1-based)"),
          pane: tool.schema
            .number()
            .optional()
            .default(0)
            .describe("Pane index within the window. Defaults to 0."),
          command: tool.schema
            .string()
            .describe("Command to send to the pane"),
          enter: tool.schema
            .boolean()
            .optional()
            .default(true)
            .describe("Whether to press Enter after the command. Defaults to true."),
        },
        async execute(args) {
          const session = args.session || (await getCurrentSession($))
          if (!session) {
            return "Error: Could not determine tmux session. Specify session parameter."
          }
          
          const target = `${session}:${args.window}.${args.pane || 0}`
          
          try {
            if (args.enter !== false) {
              await $`tmux send-keys -t ${target} ${args.command} Enter`
            } else {
              await $`tmux send-keys -t ${target} ${args.command}`
            }
            
            return `Sent command to ${target}: ${args.command}`
          } catch (error) {
            return `Error sending command to ${target}: ${error}`
          }
        },
      }),
      
      tmux_list: tool({
        description:
          "List tmux sessions, windows, and panes. Useful for discovering available targets for other tmux commands.",
        args: {
          scope: tool.schema
            .enum(["current", "all"])
            .optional()
            .default("current")
            .describe("'current' for current session only, 'all' for all sessions. Defaults to 'current'."),
          servers_only: tool.schema
            .boolean()
            .optional()
            .default(false)
            .describe("Only show panes running server processes (bun, node, docker, etc.)"),
        },
        async execute(args) {
          const currentSession = await getCurrentSession($)
          
          if (args.scope === "current") {
            if (!currentSession) {
              return "Not in a tmux session. Use scope='all' to list all sessions."
            }
            
            const windows = await getWindows($, currentSession)
            let output = `## Session: ${currentSession}\n\n`
            
            for (const win of windows) {
              output += `### Window ${win.index}: ${win.name}\n`
              for (const pane of win.panes) {
                if (args.servers_only && !isServerProcess(pane.command)) continue
                const serverTag = isServerProcess(pane.command) ? " [SERVER]" : ""
                output += `  - Pane ${pane.pane}: ${pane.command}${serverTag}\n`
                output += `    Path: ${pane.path}\n`
              }
            }
            
            return output
          }
          
          const sessions = await getSessions($)
          let output = `## All tmux sessions\n\n`
          
          for (const session of sessions) {
            const isCurrent = session.name === currentSession
            output += `### Session: ${session.name}${isCurrent ? " (current)" : ""}\n`
            
            for (const win of session.windows) {
              output += `  Window ${win.index}: ${win.name}\n`
              for (const pane of win.panes) {
                if (args.servers_only && !isServerProcess(pane.command)) continue
                const serverTag = isServerProcess(pane.command) ? " [SERVER]" : ""
                output += `    - Pane ${pane.pane}: ${pane.command}${serverTag}\n`
              }
            }
            output += "\n"
          }
          
          return output
        },
      }),
    },
  }
}

export default OpencodeTmux
