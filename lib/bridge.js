import { WebSocketServer } from 'ws'

import { CONTROL, decode, encode, toFloat32 } from './protocol.js'

/**
 * WebSocket bridge between the browser microphone and the Host keyword spotter.
 *
 * The webServer hands us the raw socket after the HTTP upgrade, so the `ws`
 * server owns the handshake while keyword sessions stay per connection.
 *
 * @param {{
 *   createSession: (mode: 'wake' | 'dictate') => {push: (samples: Float32Array) => any[], flush: (seconds?: number) => any[], close: () => void},
 *   path?: string,
 *   logger?: {warn: (error: unknown) => void},
 * }} options
 */
export function createBridge(options) {
  const wss = new WebSocketServer({ noServer: true })
  const sessions = new Set()

  wss.on('connection', (ws) => {
    /** @type {'wake' | 'dictate' | 'confirm'} */
    let mode = 'wake'
    let session = options.createSession(mode)
    sessions.add(session)
    // Per-connection view: the shared counters mix the UI with any diagnostic
    // probe, which made "why no wake" impossible to answer from /stats.
    const entry = {
      id: (options.stats?.nextId ?? 1),
      client: 'unknown',
      connected: true,
      mode,
      frames: 0,
      hits: 0,
      lastRms: 0,
    }
    if (options.stats) {
      options.stats.nextId = entry.id + 1
      options.stats.connections = (options.stats.connections ?? 0) + 1
      options.stats.clients = options.stats.clients ?? []
      options.stats.clients.push(entry)
    }

    const send = (message) => {
      if (ws.readyState === ws.OPEN) ws.send(encode(message))
    }
    const ready = () => send({
      type: CONTROL.ready,
      mode,
      wakeWords: options.wakeWords ?? [],
      sendWords: options.sendWords ?? [],
    })
    const switchMode = (next) => {
      if (next !== 'wake' && next !== 'dictate' && next !== 'confirm') {
        throw new Error(`unknown mode "${String(next)}"`)
      }
      // Re-switching to the current mode is a restart: the client sends
      // `dictate` again when the wake word is repeated mid-take, and the
      // keyword stream has to start from silence.
      session.close()
      sessions.delete(session)
      mode = next
      session = options.createSession(mode)
      sessions.add(session)
      entry.mode = mode
      entry.restarts = (entry.restarts ?? 0) + 1
      ready()
    }
    const reportHits = (hits) => {
      for (const hit of hits) {
        entry.hits += 1
        if (options.stats) options.stats.hits = (options.stats.hits ?? 0) + 1
        send({
          type: CONTROL.hit,
          mode,
          kind: options.classify?.(hit.keyword, mode),
          keyword: hit.keyword,
          start: hit.start_time,
          timestamps: hit.timestamps,
        })
      }
    }

    ws.on('message', (data, isBinary) => {
      try {
        if (!isBinary) {
          const message = decode(data)
          if (message === undefined) return send({ type: CONTROL.error, message: 'malformed control frame' })
          if (message.type === CONTROL.hello) {
            entry.client = typeof message.client === 'string' ? message.client : 'unknown'
            return ready()
          }
          if (message.type === CONTROL.mode) return switchMode(message.value)
          if (message.type === CONTROL.flush) return reportHits(session.flush())
          if (message.type === 'debug') {
            if (options.stats) options.stats.lastDebug = message.data
            return undefined
          }
          return send({ type: CONTROL.error, message: `unknown message "${message.type}"` })
        }
        const samples = toFloat32(data)
        const stats = options.stats
        let rms = 0
        for (let i = 0; i < samples.length; i += 1) rms += samples[i] * samples[i]
        rms = Math.sqrt(rms / samples.length)
        entry.frames += 1
        entry.lastRms = rms
        if (stats) {
          stats.frames = (stats.frames ?? 0) + 1
          stats.samples = (stats.samples ?? 0) + samples.length
          stats.lastRms = rms
        }
        reportHits(session.push(samples))
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        options.logger?.warn(error)
        send({ type: CONTROL.error, message })
      }
    })

    ws.on('close', () => {
      session.close()
      sessions.delete(session)
      entry.connected = false
    })
  })

  return {
    /**
     * Upgrade handler for `webServer.registerUpgrade({ path, handler })`.
     *
     * @param {import('node:http').IncomingMessage} request
     * @param {import('node:stream').Duplex} socket
     * @param {Buffer} head
     */
    handleUpgrade(request, socket, head) {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request)
      })
    },

    close() {
      for (const client of wss.clients) client.close()
      for (const session of sessions) session.close()
      sessions.clear()
      wss.close()
    },
  }
}
