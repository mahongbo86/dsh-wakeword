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
    /** @type {'wake' | 'dictate'} */
    let mode = 'wake'
    let session = options.createSession(mode)
    sessions.add(session)
    if (options.stats) {
      options.stats.connections = (options.stats.connections ?? 0) + 1
      options.stats.connected = true
      options.stats.mode = mode
    }

    const send = (message) => {
      if (ws.readyState === ws.OPEN) ws.send(encode(message))
    }
    const ready = () => send({ type: CONTROL.ready, mode, wakeWords: options.wakeWords ?? [] })
    const switchMode = (next) => {
      if (next !== 'wake' && next !== 'dictate') throw new Error(`unknown mode "${String(next)}"`)
      if (next === mode) return
      session.close()
      sessions.delete(session)
      mode = next
      session = options.createSession(mode)
      sessions.add(session)
      if (options.stats) options.stats.mode = mode
      ready()
    }
    const reportHits = (hits) => {
      for (const hit of hits) {
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
          if (message.type === CONTROL.hello) return ready()
          if (message.type === CONTROL.mode) return switchMode(message.value)
          if (message.type === CONTROL.flush) return reportHits(session.flush())
          return send({ type: CONTROL.error, message: `unknown message "${message.type}"` })
        }
        const samples = toFloat32(data)
        const stats = options.stats
        if (stats) {
          stats.frames = (stats.frames ?? 0) + 1
          stats.samples = (stats.samples ?? 0) + samples.length
          let sum = 0
          for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i]
          stats.lastRms = Math.sqrt(sum / samples.length)
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
      if (options.stats) options.stats.connected = false
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
