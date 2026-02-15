#!/usr/bin/env node
/**
 * Translation validation script for CI
 *
 * Validates that all translation files:
 * - Have the same keys as en.json (reference)
 * - Don't have missing translations
 * - Have consistent placeholders
 * - Don't contain untranslated English text
 *
 * Exit codes:
 * - 0: All validations passed
 * - 1: Validation errors found
 */

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const MESSAGES_DIR = join(__dirname, '..', 'messages');
const REFERENCE_LANG = 'en';

// Common English words that shouldn't appear in non-English translations
const ENGLISH_INDICATORS = [
  'the',
  'and',
  'for',
  'with',
  'from',
  'to',
  'in',
  'on',
  'at',
  'click',
  'select',
  'choose',
  'save',
  'cancel',
  'close',
  'open',
  'settings',
  'language',
  'model',
  'analysis',
  'detection',
];

// Brand names and technical terms that are allowed to be identical
const ALLOWED_IDENTICAL = [
  'Birda GUI',
  'birda CLI',
  'eBird',
  'CUDA',
  'TensorRT',
  'GPU',
  'CPU',
  'WAV',
  'MP3',
  'FLAC',
  'OGG',
  'M4A',
  'NSIS',
  'JSON',
  'API',
];

// Message keys that are allowed to be identical across languages
// (technical terms, abbreviations, proper nouns, etc.)
const IGNORED_IDENTICAL_KEYS = new Set([
  // Audio/technical terms
  'sourceFiles_mono',
  'sourceFiles_stereo',
  'table_columnClip',
  'audio_pause',
  // Short generic words
  'settings_tab_data',
  'sourceFiles_columnName',
  'sourceFiles_columnFormat',
  'sourceFiles_columnStatus',
  'table_columnOffset',
  // Size indicators
  'settings_spectrogram_heightMedium',
  'settings_spectrogram_heightXL',
  // Calendar (month names are often similar across European languages)
  'calendar_month_april',
  'calendar_month_august',
  'calendar_month_september',
  'calendar_month_november',
  // Weekday abbreviations (often similar)
  'calendar_weekday_mo',
  'calendar_weekday_fr',
  'calendar_weekday_sa',
  'calendar_weekday_su',
  // Technical hints/labels
  'species_fetch_weekHint',
  'speciesSearch_detCount',
  'analysis_statusCoords',
  'settings_general_title',
  // Sorting/technical labels
  'species_card_maxConfidence',
  'species_card_sortName',
]);

/**
 * Load translations from a JSON file
 * @param {string} lang - Language code
 * @returns {Record<string, string>}
 */
function loadTranslations(lang) {
  const filePath = join(MESSAGES_DIR, `${lang}.json`);
  try {
    const content = readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    throw new Error(`Failed to load ${lang}.json: ${error.message}`);
  }
}

/**
 * Extract placeholders from a translation string
 * @param {string} text - Translation text
 * @returns {string[]}
 */
function extractPlaceholders(text) {
  const matches = text.match(/\{[^}]+\}/g);
  return matches || [];
}

/**
 * Check if text contains English words
 * @param {string} text - Text to check
 * @param {number} threshold - Minimum number of English words to detect
 * @returns {boolean}
 */
function hasEnglishWords(text, threshold = 3) {
  // Skip if text contains placeholders or special characters
  if (text.includes('{') || text.includes('<') || text.includes('>')) {
    return false;
  }

  const lowerText = text.toLowerCase();
  let englishWordCount = 0;

  for (const word of ENGLISH_INDICATORS) {
    // Use word boundaries to avoid false positives
    const regex = new RegExp(`\\b${word}\\b`, 'i');
    if (regex.test(lowerText)) {
      englishWordCount++;
      if (englishWordCount >= threshold) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Validate a language file against the reference
 * @param {string} lang - Language code
 * @param {Record<string, string>} reference - Reference translations
 * @returns {{file: string, errors: string[], warnings: string[]}}
 */
function validateLanguage(lang, reference) {
  const result = {
    file: `${lang}.json`,
    errors: [],
    warnings: [],
  };

  const translations = loadTranslations(lang);
  const referenceKeys = Object.keys(reference);
  const translationKeys = Object.keys(translations);

  // Check key count
  if (referenceKeys.length !== translationKeys.length) {
    result.errors.push(`Key count mismatch: expected ${referenceKeys.length}, got ${translationKeys.length}`);
  }

  // Check for missing keys
  const missingKeys = referenceKeys.filter((key) => !(key in translations));
  if (missingKeys.length > 0) {
    result.errors.push(`Missing keys: ${missingKeys.join(', ')}`);
  }

  // Check for extra keys
  const extraKeys = translationKeys.filter((key) => !(key in reference));
  if (extraKeys.length > 0) {
    result.errors.push(`Extra keys not in reference: ${extraKeys.join(', ')}`);
  }

  // Check each key
  for (const key of referenceKeys) {
    if (!(key in translations)) {
      continue; // Already reported as missing
    }

    const refValue = reference[key];
    const transValue = translations[key];

    // Check for empty translations
    if (!transValue || transValue.trim() === '') {
      result.errors.push(`Empty translation for key: ${key}`);
      continue;
    }

    // Check for identical values (possible untranslated)
    if (lang !== REFERENCE_LANG && refValue === transValue) {
      // Skip if key is in ignore list or contains allowed identical terms
      if (!IGNORED_IDENTICAL_KEYS.has(key) && !ALLOWED_IDENTICAL.some((term) => refValue.includes(term))) {
        result.warnings.push(`Possibly untranslated (identical to English): ${key}`);
      }
    }

    // Check placeholder consistency
    const refPlaceholders = extractPlaceholders(refValue).sort();
    const transPlaceholders = extractPlaceholders(transValue).sort();

    if (JSON.stringify(refPlaceholders) !== JSON.stringify(transPlaceholders)) {
      result.errors.push(
        `Placeholder mismatch in "${key}": ` +
          `expected [${refPlaceholders.join(', ')}], got [${transPlaceholders.join(', ')}]`,
      );
    }

    // Check for English words in non-English translations (skip brand names)
    if (lang !== REFERENCE_LANG) {
      const hasBrandNames = ALLOWED_IDENTICAL.some((term) => transValue.includes(term));
      if (!hasBrandNames && hasEnglishWords(transValue)) {
        result.warnings.push(`Possible English text in "${key}": "${transValue}"`);
      }
    }
  }

  return result;
}

function main() {
  console.log('🔍 Validating translation files...\n');

  try {
    // Load reference language
    const reference = loadTranslations(REFERENCE_LANG);
    console.log(`✓ Reference (${REFERENCE_LANG}.json): ${Object.keys(reference).length} keys\n`);

    // Get all language files
    const files = readdirSync(MESSAGES_DIR).filter((f) => f.endsWith('.json') && f !== `${REFERENCE_LANG}.json`);

    if (files.length === 0) {
      console.log('⚠️  No translation files found besides reference\n');
      process.exit(0);
    }

    const results = [];
    let totalErrors = 0;
    let totalWarnings = 0;

    // Validate each language
    for (const file of files) {
      const lang = file.replace('.json', '');
      const result = validateLanguage(lang, reference);
      results.push(result);

      totalErrors += result.errors.length;
      totalWarnings += result.warnings.length;
    }

    // Print results
    for (const result of results) {
      const status = result.errors.length === 0 ? '✓' : '✗';
      console.log(`${status} ${result.file}`);

      if (result.errors.length > 0) {
        console.log(`  Errors (${result.errors.length}):`);
        result.errors.forEach((err) => console.log(`    • ${err}`));
      }

      if (result.warnings.length > 0) {
        console.log(`  Warnings (${result.warnings.length}):`);
        result.warnings.forEach((warn) => console.log(`    ⚠ ${warn}`));
      }

      console.log();
    }

    // Summary
    console.log('─'.repeat(60));
    if (totalErrors === 0 && totalWarnings === 0) {
      console.log('✅ All translation files are valid!');
      process.exit(0);
    } else {
      console.log(`Summary: ${totalErrors} error(s), ${totalWarnings} warning(s)`);

      if (totalErrors > 0) {
        console.log('❌ Validation failed');
        process.exit(1);
      } else {
        console.log('⚠️  Validation passed with warnings');
        process.exit(0);
      }
    }
  } catch (error) {
    console.error('💥 Validation script failed:', error.message);
    process.exit(1);
  }
}

main();
