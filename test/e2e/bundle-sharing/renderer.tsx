import { WorkspaceBundleSaveDialog } from '@/components/WorkspaceConfiguration/WorkspaceBundleSaveDialog';
import en from '@/i18n/locales/en-us/layout.json';
import fr from '@/i18n/locales/fr/layout.json';
import {
  createDefaultThemeContractV2,
  DEFAULT_THEME_CATALOG,
} from '@/lib/themeTokens/catalog';
import { buildThemeV2 } from '@/lib/themeTokens/engine';
import type { Mode } from '@/lib/themeTokens/types';
import '@/style/index.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/700.css';
import i18next from 'i18next';
import { createRoot } from 'react-dom/client';
import { initReactI18next } from 'react-i18next';
import { draft, releasePublish, releaseReview } from './fixtures';

await i18next.use(initReactI18next).init({
  lng: 'en',
  fallbackLng: 'en',
  resources: {
    en: { translation: { layout: en } },
    fr: { translation: { layout: fr } },
  },
  interpolation: { escapeValue: false },
});

const setTheme = (mode: Mode, themeId = 'eigent', contrast = 43) => {
  const theme = buildThemeV2(
    createDefaultThemeContractV2(mode, { themeId, contrast })
  );
  document.documentElement.classList.toggle('dark', mode === 'dark');
  document.documentElement.style.colorScheme = mode;
  for (const [name, value] of Object.entries(theme.cssVariables)) {
    document.documentElement.style.setProperty(name, value);
  }
};
setTheme('light');

declare global {
  interface Window {
    bundleProbe: {
      setTheme: typeof setTheme;
      themes: string[];
      releaseReview: typeof releaseReview;
      releasePublish: typeof releasePublish;
      setLanguage: (language: string) => Promise<unknown>;
    };
  }
}
window.bundleProbe = {
  setTheme,
  themes: Object.keys(DEFAULT_THEME_CATALOG.light),
  releaseReview,
  releasePublish,
  setLanguage: (language) => i18next.changeLanguage(language),
};

createRoot(document.getElementById('root')!).render(
  <WorkspaceBundleSaveDialog
    open
    spaceId="contrast-probe"
    identity={{ email: 'probe@example.com', userId: 42 }}
    draft={draft}
    onOpenChange={() => {}}
    onApplyRequirements={() => {}}
    onApplyMcpSecretSlots={() => {}}
    onPublished={() => {}}
  />
);
