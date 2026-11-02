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
      ready()
    }
    const reportHits = (hits) => {
      for (const hit of hits) {
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
        reportHits(session.push(toFloat32(data)))
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        options.logger?.warn(error)
        send({ type: CONTROL.error, message })
      }
    })

    ws.on('close', () => {
      session.close()
      sessions.delete(session)
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
