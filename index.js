/**
 * Host half of dsh-wakeword.
 *
 * Registers a WebSocket upgrade route on the Harness web server. The browser
 * streams 16 kHz mono Float32 frames; this half runs sherpa-onnx keyword
 * spotting and answers with hits that carry token timestamps.
 */
import fs from 'node:fs'
import path from 'node:path'

import { createBridge } from './lib/bridge.js'
import { createClassifier } from './lib/classify.js'
import { keywordCacheDir, resolveConfig } from './lib/config.js'
import { loadTokens, writeKeywordsFile } from './lib/keywords.js'
import { KeywordSession } from './lib/kws.js'

export const name = 'dsh-wakeword'
export const inject = ['webServer']

// Import-time marker: distinguishes "bundle never loaded" from "apply failed"
// when the next activation is diagnosed from disk.
try {
  const markerDir = `${process.env.DSH_HOME ?? `${process.env.USERPROFILE ?? '.'}/.dsh`}/cache/dsh-wakeword`
  fs.mkdirSync(markerDir, { recursive: true })
  fs.writeFileSync(`${markerDir}/import.json`, `${JSON.stringify({ at: new Date().toISOString() })}\n`)
} catch {
  // diagnostics only
}

/** Record the activation outcome where the next debugging session can read it. */
function writeDiagnostic(cacheDir, record) {
  try {
    fs.mkdirSync(cacheDir, { recursive: true })
    fs.writeFileSync(path.join(cacheDir, 'activation.json'), `${JSON.stringify(record, null, 2)}\n`)
  } catch {
    // diagnostics must never mask the real failure
  }
}

export function apply(ctx, rawConfig) {
  const home = process.env.DSH_HOME ?? `${process.env.USERPROFILE ?? '.'}/.dsh`
  let cacheDir = keywordCacheDir(home)

  try {
    const config = resolveConfig(rawConfig)
    cacheDir = keywordCacheDir(home)

    const tokensFile = path.join(config.modelDir, 'tokens.txt')
    if (!fs.existsSync(tokensFile)) {
      throw new Error(`model directory ${config.modelDir} has no tokens.txt`)
    }

    const tokens = loadTokens(tokensFile)
    fs.mkdirSync(cacheDir, { recursive: true })

    const wakeFile = path.join(cacheDir, 'wake.txt')
    const dictateFile = path.join(cacheDir, 'dictate.txt')
    const confirmFile = path.join(cacheDir, 'confirm.txt')
    writeKeywordsFile(wakeFile, config.keywords.wake, tokens)
    writeKeywordsFile(dictateFile, [...config.keywords.wake, ...config.keywords.stop, ...config.keywords.cancel], tokens)
    writeKeywordsFile(confirmFile, [...config.keywords.wake, ...config.keywords.send, ...config.keywords.cancel], tokens)

    const stats = {}
    const bridge = createBridge({
      logger: ctx.logger,
      classify: createClassifier(config.keywords),
      wakeWords: config.keywords.wake,
      sendWords: config.keywords.send,
      stats,
      createSession: (mode) => new KeywordSession({
        modelDir: config.modelDir,
        keywordsFile: mode === 'wake' ? wakeFile : mode === 'confirm' ? confirmFile : dictateFile,
        threshold: config.threshold,
        numThreads: config.numThreads,
      }),
    })

    const disposeRoute = ctx.webServer.registerUpgrade({
      path: config.path,
      handler: bridge.handleUpgrade,
    })

    // The control shows the wake word before it ever connects, so the words
    // are readable over plain HTTP as well. The page runs on dsh-app://app, so
    // these cross-origin reads need CORS.
    const disposeConfig = ctx.webServer.register({
      kind: 'exact',
      path: `${config.path}/config`,
      handler: (request, response) => {
        response.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
          'access-control-allow-origin': '*',
        })
        response.end(JSON.stringify({
          wakeWords: config.keywords.wake,
          stop: config.keywords.stop,
          cancel: config.keywords.cancel,
          send: config.keywords.send,
          autoStart: config.autoStart,
        }))
      },
    })

    const disposeStats = ctx.webServer.register({
      kind: 'exact',
      path: `${config.path}/stats`,
      handler: (request, response) => {
        response.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
          'access-control-allow-origin': '*',
        })
        response.end(JSON.stringify({ ...stats, threshold: config.threshold, keywords: config.keywords }))
      },
    })

    ctx.effect(() => () => {
      disposeRoute()
      disposeConfig()
      disposeStats()
      bridge.close()
    })

    writeDiagnostic(cacheDir, {
      at: new Date().toISOString(),
      ok: true,
      path: config.path,
      modelDir: config.modelDir,
      keywords: config.keywords,
      serverPort: ctx.webServer.port,
      serverHost: ctx.webServer.host,
      hasRegisterUpgrade: typeof ctx.webServer.registerUpgrade,
    })
    ctx.logger?.info?.(`dsh-wakeword: listening on ${config.path}`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    writeDiagnostic(cacheDir, { at: new Date().toISOString(), ok: false, error: message })
    ctx.logger?.error?.(error)
    throw error
  }
}
