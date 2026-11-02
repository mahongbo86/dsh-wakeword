import fs from 'node:fs'
import path from 'node:path'

const PARTS = ['encoder', 'decoder', 'joiner']

/**
 * Resolve the ONNX files of a sherpa-onnx KWS model directory.
 *
 * @param {string} dir model directory
 * @param {{epoch?: string, int8?: boolean}} [options]
 * @returns {{encoder: string, decoder: string, joiner: string, tokens: string}}
 */
export function resolveModel(dir, options = {}) {
  const epoch = options.epoch ?? '12-avg-2'
  const int8 = options.int8 ?? true
  const suffix = int8 ? '.int8.onnx' : '.onnx'
  const base = `epoch-${epoch}-chunk-16-left-64`

  /** @type {Record<string, string>} */
  const files = { tokens: path.join(dir, 'tokens.txt') }
  for (const part of PARTS) {
    files[part] = path.join(dir, `${part}-${base}${suffix}`)
  }

  const missing = Object.values(files).filter((file) => !fs.existsSync(file))
  if (missing.length > 0) {
    throw new Error(`incomplete KWS model at ${dir}; missing: ${missing.map((f) => path.basename(f)).join(', ')}`)
  }

  return files
}

/**
 * Describe what a model directory is missing without throwing.
 *
 * @param {string} dir
 * @param {{epoch?: string, int8?: boolean}} [options]
 */
export function describeModel(dir, options = {}) {
  try {
    resolveModel(dir, options)
    return { ready: true, missing: [] }
  } catch (error) {
    return { ready: false, missing: error instanceof Error ? error.message : String(error) }
  }
}
