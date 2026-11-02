/**
 * Classify a detected keyword by the mode it was spotted in. The browser only
 * needs to know whether to start dictation, finish it, or throw the take away.
 *
 * @param {{wake: string[], stop: string[], cancel: string[]}} keywords
 * @returns {(keyword: string, mode: 'wake' | 'dictate') => 'wake' | 'stop' | 'cancel' | undefined}
 */
export function createClassifier(keywords) {
  return (keyword, mode) => {
    if (mode === 'wake') return keywords.wake.includes(keyword) ? 'wake' : undefined
    if (keywords.stop.includes(keyword)) return 'stop'
    if (keywords.cancel.includes(keyword)) return 'cancel'
    return undefined
  }
}
