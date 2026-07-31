import { describe, expect, it } from 'vitest'
import { LANGUAGES, REQUIRED_TRANSLATION_KEYS, hasTranslation, languageLocale, normalizeLanguage, translate } from './i18n'

describe('platform i18n', () => {
  it('exposes every supported language with a locale', () => {
    expect(LANGUAGES.map((language) => language.code)).toEqual(['zh', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'pt', 'tr'])
    expect(languageLocale('tr')).toBe('tr-TR')
    expect(normalizeLanguage('pt-BR')).toBe('pt')
  })

  it('translates Turkish interface copy', () => {
    expect(translate('tr', '创建账户', 'Create account')).toBe('Hesap oluştur')
  })

  it.each(['ja', 'ko', 'es', 'fr', 'de', 'pt', 'tr'] as const)('contains every extracted UI message for %s', (language) => {
    const missing = REQUIRED_TRANSLATION_KEYS.filter((key) => !hasTranslation(language, key))
    expect(missing).toEqual([])
  })
})
