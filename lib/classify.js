/**
 * Classify a detected keyword by the mode it was spotted in. The wake word is
 * recognised in every mode: saying it again starts a fresh take.
 *
 * @param {{wake: string[], stop: string[], cancel: string[], send?: string[]}} keywords
 * @returns {(keyword: string, mode: 'wake' | 'dictate' | 'confirm') => 'wake' | 'stop' | 'cancel' | 'send' | undefined}
 */
export function createClassifier(keywords) {
  const send = keywords.send ?? []
  return (keyword, mode) => {
    if (keywords.wake.includes(keyword)) return 'wake'
    if (keywords.cancel.includes(keyword)) return 'cancel'
    if (mode === 'confirm') return send.includes(keyword) ? 'send' : undefined
    if (keywords.stop.includes(keyword)) return 'stop'
    return undefined
  }
}
