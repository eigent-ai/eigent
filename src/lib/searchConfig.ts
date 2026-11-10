export const QUERIT_ENABLED = 'QUERIT_ENABLED';
export const QUERIT_API_KEY = 'QUERIT_API_KEY';
export const GOOGLE_API_KEY = 'GOOGLE_API_KEY';
export const SEARCH_ENGINE_ID = 'SEARCH_ENGINE_ID';

export interface StoredSearchConfig {
  config_name?: string;
  config_value?: unknown;
}

function configValue(configs: StoredSearchConfig[], name: string): string {
  const value = configs.find(
    (config) => config.config_name === name
  )?.config_value;
  return typeof value === 'string' ? value.trim() : '';
}

export function isQueritSearchEnabled(configs: StoredSearchConfig[]): boolean {
  return ['1', 'true', 'yes', 'on'].includes(
    configValue(configs, QUERIT_ENABLED).toLowerCase()
  );
}

export function isGoogleSearchConfigured(
  configs: StoredSearchConfig[]
): boolean {
  return Boolean(
    configValue(configs, GOOGLE_API_KEY) &&
    configValue(configs, SEARCH_ENGINE_ID)
  );
}

export function isSearchConfigured(configs: StoredSearchConfig[]): boolean {
  return isQueritSearchEnabled(configs) || isGoogleSearchConfigured(configs);
}

export function buildSearchRuntimeConfig(
  configs: StoredSearchConfig[],
  options: { includeGoogle: boolean }
): Record<string, string> {
  const queritEnabled = isQueritSearchEnabled(configs);
  const runtimeConfig: Record<string, string> = {
    [QUERIT_ENABLED]: queritEnabled ? 'true' : 'false',
  };

  const queritApiKey = configValue(configs, QUERIT_API_KEY);
  if (queritEnabled && queritApiKey) {
    runtimeConfig[QUERIT_API_KEY] = queritApiKey;
  }

  if (options.includeGoogle) {
    const googleApiKey = configValue(configs, GOOGLE_API_KEY);
    const searchEngineId = configValue(configs, SEARCH_ENGINE_ID);
    if (googleApiKey && searchEngineId) {
      runtimeConfig[GOOGLE_API_KEY] = googleApiKey;
      runtimeConfig[SEARCH_ENGINE_ID] = searchEngineId;
    }
  }

  return runtimeConfig;
}
