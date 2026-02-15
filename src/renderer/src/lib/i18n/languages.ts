/**
 * Central registry of all available UI languages.
 * This is the single source of truth for language metadata.
 */

interface LanguageInfo {
  code: string; // ISO 639-1 language code
  nativeName: string; // Language name in native script
  englishName: string; // Language name in English
  dir: 'ltr' | 'rtl'; // Text direction
}

/**
 * All available UI languages.
 * To add a new language:
 * 1. Add entry here
 * 2. Create messages/{code}.json
 * 3. Update project.inlang/settings.json languageTags array
 */
export const LANGUAGES: LanguageInfo[] = [
  { code: 'en', nativeName: 'English', englishName: 'English', dir: 'ltr' },
  { code: 'fi', nativeName: 'Suomi', englishName: 'Finnish', dir: 'ltr' },
  { code: 'sv', nativeName: 'Svenska', englishName: 'Swedish', dir: 'ltr' },
  { code: 'de', nativeName: 'Deutsch', englishName: 'German', dir: 'ltr' },
  { code: 'es', nativeName: 'Español', englishName: 'Spanish', dir: 'ltr' },
  { code: 'fr', nativeName: 'Français', englishName: 'French', dir: 'ltr' },
  { code: 'it', nativeName: 'Italiano', englishName: 'Italian', dir: 'ltr' },
];

/**
 * Get language metadata by code.
 * @param code - ISO 639-1 language code (e.g., 'en', 'fi')
 * @returns Language metadata or undefined if not found
 */
export function getLanguage(code: string): LanguageInfo | undefined {
  return LANGUAGES.find((lang) => lang.code === code);
}

/**
 * Get all available language codes.
 * @returns Array of language codes
 */
export function getLanguageCodes(): string[] {
  return LANGUAGES.map((lang) => lang.code);
}
