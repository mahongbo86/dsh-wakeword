const DEFAULT_KEYWORDS = {
  wake: ['嘿小助手'],
  stop: ['说完了'],
  cancel: ['不用了'],
  send: ['发送'],
}

/**
 * Normalize the row config from cordis.patch.yml. Validation is explicit so a
 * broken profile row fails with a readable message instead of a stack trace
 * from inside sherpa.
 *
 * @param {any} raw
 */
export function resolveConfig(raw) {
  const config = raw ?? {}
  const modelDir = config.modelDir ?? defaultModelDir()

  if (typeof modelDir !== 'string' || modelDir.length === 0) {
    throw new Error('dsh-wakeword: config.modelDir must point at a sherpa-onnx KWS model directory')
  }

  const keywords = { ...DEFAULT_KEYWORDS }
  if (config.keywords !== undefined) {
    for (const key of ['wake', 'stop', 'cancel', 'send']) {
      const value = config.keywords[key]
      if (value === undefined) continue
      if (!Array.isArray(value) || value.some((word) => typeof word !== 'string' || word.length === 0)) {
        throw new Error(`dsh-wakeword: config.keywords.${key} must be a non-empty array of strings`)
      }
      keywords[key] = value
    }
  }

  return {
    path: typeof config.path === 'string' && config.path.startsWith('/') ? config.path : '/wakeword',
    modelDir,
    threshold: typeof config.threshold === 'number' ? config.threshold : 0.25,
    numThreads: typeof config.numThreads === 'number' ? config.numThreads : 1,
    // A wake-word plugin that must be clicked on every launch is not much of a
    // wake-word plugin; opt out with autoStart: false.
    autoStart: config.autoStart !== false,
    keywords,
  }
}

/** Default model location under the DSH home, used until the download step lands. */
export function defaultModelDir() {
  return `${dshHome()}/models/kws/sherpa-onnx-kws-zipformer-wenetspeech-3.3M-2024-01-01`
}

/**
 * DSH home. The GUI process does not reliably export DSH_HOME, so fall back to
 * the same `~/.dsh` the launcher uses.
 */
export function dshHome() {
  if (process.env.DSH_HOME) return process.env.DSH_HOME
  return `${process.env.USERPROFILE ?? process.env.HOME ?? '.'}/.dsh`.replace(/\\/g, '/')
}

/**
 * Directory for generated keywords files. Prefers the DSH home so files
 * survive temp cleanup; falls back to the OS temp directory.
 *
 * @param {string} dshHome
 */
export function keywordCacheDir(dshHome) {
  return dshHome ? `${dshHome}/cache/dsh-wakeword` : `${process.env.TEMP ?? '/tmp'}/dsh-wakeword`
}
