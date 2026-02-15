import { mount } from 'svelte';
import App from './App.svelte';
import './app.css';
import 'maplibre-gl/dist/maplibre-gl.css';
import { setLocale, isLocale } from '$paraglide/runtime';
import { getSettings, getSystemLocale } from '$lib/utils/ipc';
import { detectLanguage } from '$lib/i18n/detect';

// Set UI locale from persisted settings before mounting the app.
// Using { reload: false } because no components exist yet — a reload here
// would cause an infinite loop. The locale is set before mount() so all
// components render with the correct language from the start.
try {
  const settings = await getSettings();
  console.log('[main.ts] App starting, ui_language from settings:', settings.ui_language);

  // If no UI language is set, auto-detect from system locale
  if (!settings.ui_language) {
    try {
      const systemLocale = await getSystemLocale();
      const detectedLang = detectLanguage(systemLocale);
      console.log('[main.ts] Auto-detected language:', detectedLang);
      if (isLocale(detectedLang)) {
        void setLocale(detectedLang, { reload: false });
      }
    } catch {
      // Auto-detection failed, use default (en)
    }
  } else if (isLocale(settings.ui_language)) {
    // Use saved language preference
    console.log('[main.ts] Setting locale to:', settings.ui_language, 'with reload:false');
    void setLocale(settings.ui_language, { reload: false });
  }
} catch {
  // Settings may fail on first run — default locale (en) is fine
}

const app = mount(App, { target: document.getElementById('app')! });
export default app;
