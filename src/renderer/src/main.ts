import { mount } from 'svelte';
import App from './App.svelte';
import './app.css';
import 'maplibre-gl/dist/maplibre-gl.css';
import { setLocale, isLocale } from '$paraglide/runtime';
import { getSettings } from '$lib/utils/ipc';

// Set UI locale from persisted settings before mounting the app.
// Using { reload: false } because no components exist yet — a reload here
// would cause an infinite loop. The locale is set before mount() so all
// components render with the correct language from the start.
try {
  const settings = await getSettings();
  if (settings.ui_language && isLocale(settings.ui_language)) {
    void setLocale(settings.ui_language, { reload: false });
  }
} catch {
  // Settings may fail on first run — default locale (en) is fine
}

const app = mount(App, { target: document.getElementById('app')! });
export default app;
