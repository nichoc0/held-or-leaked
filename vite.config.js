import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'
import net from 'node:net'
import http from 'node:http'
import https from 'node:https'
import fs from 'node:fs'
import { execFile } from 'node:child_process'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Real log sources, keyed by tool `service` — each points at that tool's
// ACTUAL log (a container's docker logs, or a real logfile on disk). Tools
// that are offline / remote / library-only have no log to show and honestly
// report "no source".
const LOG_SOURCES = {
  falkordb:        { kind: 'docker', container: 'bastion-falkordb' },
  redis:           { kind: 'docker', container: 'clip-redis' },
  'voice-gateway': { kind: 'file', path: '/Users/nca/.openclaw/logs/voice-gateway.log' },
  ollama:          { kind: 'file', path: '/opt/homebrew/var/log/ollama.log' },
  camoufox:        { kind: 'file', path: '/Users/nca/weavehacks/clip/.toollogs/camoufox.log' },
  ghidra:          { kind: 'file', path: '/Users/nca/weavehacks/clip/.toollogs/ghidra-mcp.log' },
  weave:           { kind: 'file', path: '/Users/nca/weavehacks/harness/weave.log' },
}

// FalkorDB access goes through the bastion-kg venv python (has falkordb client)
const FALKOR_PY = '/Users/nca/bastion-kg/.venv/bin/python'
const TOOLS = fileURLToPath(new URL('./tools', import.meta.url))

// strip ANSI colour escapes so logs read clean in the browser
const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, '')

function dockerLogs(container, tail = 200) {
  return new Promise((resolve) => {
    execFile('docker', ['logs', '--tail', String(tail), container], { timeout: 4000 }, (err, stdout, stderr) => {
      if (err && !stdout && !stderr) return resolve(null)
      const lines = `${stderr || ''}${stdout || ''}`.split('\n').map((l) => stripAnsi(l).trimEnd()).filter(Boolean)
      resolve(lines)
    })
  })
}

// Tail the last ~96KB of a logfile (cheap, no full read), return last N lines.
function tailFile(path, maxLines = 200) {
  try {
    const { size } = fs.statSync(path)
    const want = Math.min(size, 96 * 1024)
    const fd = fs.openSync(path, 'r')
    const buf = Buffer.alloc(want)
    fs.readSync(fd, buf, 0, want, size - want)
    fs.closeSync(fd)
    const lines = buf.toString('utf8').split('\n').map((l) => stripAnsi(l).trimEnd()).filter(Boolean)
    return lines.slice(-maxLines)
  } catch {
    return null
  }
}

// Real health probes, server-side (a browser can't TCP-check Redis or hit
// cross-origin hosts). Keyed by the tool `service` ids in src/data/toolbox.js.
// `kind: 'fs'` = a library that's installed-but-not-a-daemon → reports idle.
const PROBES = {
  'target-agent':  { kind: 'http', url: 'https://weave.pistonsolutions.ai' },
  'voice-gateway': { kind: 'tcp', host: '127.0.0.1', port: 8799 },
  'falkordb':      { kind: 'tcp', host: '127.0.0.1', port: 6379 },
  'redis':         { kind: 'tcp', host: '127.0.0.1', port: 6380 },
  'weave':         { kind: 'http', url: 'https://wandb.ai' },
  'camoufox':      { kind: 'proc', match: 'tools/camoufox_run.py' },
  'frida':         { kind: 'tcp', host: '127.0.0.1', port: 27042 },
  'ghidra':        { kind: 'proc', match: 'ghidra' },
  'ollama':        { kind: 'http', url: 'http://127.0.0.1:11434/api/tags' },
}

function probeTcp({ host, port }, timeout = 1500) {
  return new Promise((resolve) => {
    const t = Date.now()
    const sock = net.connect({ host, port })
    let done = false
    const finish = (ok) => { if (done) return; done = true; sock.destroy(); resolve({ ok, ms: Date.now() - t }) }
    sock.setTimeout(timeout)
    sock.on('connect', () => finish(true))
    sock.on('error', () => finish(false))
    sock.on('timeout', () => finish(false))
  })
}

function probeHttp({ url }, timeout = 4000) {
  return new Promise((resolve) => {
    const t = Date.now()
    const lib = url.startsWith('https') ? https : http
    const req = lib.request(url, { method: 'GET', timeout }, (res) => {
      res.resume()
      resolve({ ok: res.statusCode > 0 && res.statusCode < 500, ms: Date.now() - t })
    })
    req.on('error', () => resolve({ ok: false, ms: Date.now() - t }))
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, ms: Date.now() - t }) })
    req.end()
  })
}

function probeProc({ match }) {
  return new Promise((resolve) => {
    execFile('pgrep', ['-f', match], { timeout: 1500 }, (_err, stdout) => resolve(!!(stdout && stdout.trim())))
  })
}

async function runProbe(p) {
  if (p.kind === 'tcp') { const r = await probeTcp(p); return { status: r.ok ? 'up' : 'down', latencyMs: r.ok ? r.ms : null } }
  if (p.kind === 'http') { const r = await probeHttp(p); return { status: r.ok ? 'up' : 'down', latencyMs: r.ok ? r.ms : null } }
  if (p.kind === 'proc') { const ok = await probeProc(p); return { status: ok ? 'up' : 'down', latencyMs: null } }
  if (p.kind === 'fs') { const ok = fs.existsSync(p.path); return { status: ok ? 'idle' : 'down', latencyMs: null } }
  return { status: 'down', latencyMs: null }
}


function healthPlugin() {
  return {
    name: 'clip-health',
    configureServer(server) {
      server.middlewares.use('/api/health', async (_req, res) => {
        const entries = await Promise.all(
          Object.entries(PROBES).map(async ([service, p]) => [service, await runProbe(p)]),
        )
        const out = { checkedAt: new Date().toISOString(), tools: Object.fromEntries(entries) }
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify(out))
      })

      // Global graph — the live FalkorDB cortex, dumped as force-graph triples
      server.middlewares.use('/api/graph', (req, res) => {
        if (req.url.startsWith('/commit')) {
          // feedback: MERGE the assessment's important nodes back into FalkorDB
          let body = ''
          req.on('data', (c) => { body += c })
          req.on('end', () => {
            const py = execFile(FALKOR_PY, [`${TOOLS}/falkor_commit.py`], { timeout: 8000 }, (err, stdout) => {
              res.setHeader('content-type', 'application/json')
              res.end(err ? JSON.stringify({ error: String(err) }) : (stdout || '{}'))
            })
            py.stdin.end(body || '{}')
          })
          return
        }
        execFile(FALKOR_PY, [`${TOOLS}/falkor_graph.py`], { timeout: 8000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
          res.setHeader('content-type', 'application/json')
          res.end(err ? JSON.stringify({ triples: [], error: String(err) }) : (stdout || '{"triples":[]}'))
        })
      })

      server.middlewares.use('/api/logs', async (req, res) => {
        const service = new URL(req.url, 'http://x').searchParams.get('service')
        const src = LOG_SOURCES[service]
        let lines = []
        let source = null
        if (src?.kind === 'docker') {
          lines = (await dockerLogs(src.container)) || []
          source = `docker:${src.container}`
        } else if (src?.kind === 'file') {
          lines = tailFile(src.path) || []
          source = src.path
        }
        const out = { service, source, lines, checkedAt: new Date().toISOString() }
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify(out))
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), healthPlugin()],
  base: '/',
  server: { port: 5180, host: true },
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      '@clerk/clerk-react': fileURLToPath(new URL('./src/lib/clerk-shim.jsx', import.meta.url)),
    },
  },
})
