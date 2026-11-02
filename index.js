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

export function apply(ctx, rawConfig) {
  const config = resolveConfig(rawConfig)
  const tokensFile = path.join(config.modelDir, 'tokens.txt')
  if (!fs.existsSync(tokensFile)) {
    throw new Error(`dsh-wakeword: ${tokensFile} is missing; check config.modelDir`)
  }

  const tokens = loadTokens(tokensFile)
  const cacheDir = keywordCacheDir(process.env.DSH_HOME)
  fs.mkdirSync(cacheDir, { recursive: true })

  const wakeFile = path.join(cacheDir, 'wake.txt')
  const dictateFile = path.join(cacheDir, 'dictate.txt')
  writeKeywordsFile(wakeFile, config.keywords.wake, tokens)
  writeKeywordsFile(dictateFile, [...config.keywords.stop, ...config.keywords.cancel], tokens)

  const bridge = createBridge({
    logger: ctx.logger,
    classify: createClassifier(config.keywords),
    createSession: (mode) => new KeywordSession({
      modelDir: config.modelDir,
      keywordsFile: mode === 'wake' ? wakeFile : dictateFile,
      threshold: config.threshold,
      numThreads: config.numThreads,
    }),
  })

  const disposeRoute = ctx.webServer.registerUpgrade({
    path: config.path,
    handler: bridge.handleUpgrade,
  })

  ctx.effect(() => () => {
    disposeRoute()
    bridge.close()
  })
}
