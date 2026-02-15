import { getLanguageCodes } from './languages';

/**
 * Detect the best UI language based on system locale.
 * Falls back to English if system language is not available.
 *
 * @param systemLocale - OS locale from Electron (e.g., 'en-US', 'fi-FI', 'sv-SE', 'de-DE', 'es-ES')
 * @returns Best matching language code or 'en' as fallback
 */
export function detectLanguage(systemLocale: string): string {
  const availableCodes = getLanguageCodes();

  // Try exact match first (extract primary language code from locale)
  // Examples: 'en-US' -> 'en', 'fi-FI' -> 'fi', 'sv-SE' -> 'sv'
  const primaryCode = systemLocale.split('-')[0].toLowerCase();

  if (availableCodes.includes(primaryCode)) {
    return primaryCode;
  }

  // Fallback to English
  return 'en';
}
