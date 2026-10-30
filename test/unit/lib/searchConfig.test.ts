import {
  buildSearchRuntimeConfig,
  isSearchConfigured,
} from '@/lib/searchConfig';
import { describe, expect, it } from 'vitest';

describe('searchConfig', () => {
  it('keeps the existing Google path when Querit is not enabled', () => {
    const configs = [
      { config_name: 'GOOGLE_API_KEY', config_value: 'google-key' },
      { config_name: 'SEARCH_ENGINE_ID', config_value: 'engine-id' },
    ];

    expect(buildSearchRuntimeConfig(configs, { includeGoogle: true })).toEqual({
      QUERIT_ENABLED: 'false',
      GOOGLE_API_KEY: 'google-key',
      SEARCH_ENGINE_ID: 'engine-id',
    });
    expect(isSearchConfigured(configs)).toBe(true);
  });

  it('enables Querit anonymous mode without an API key', () => {
    const configs = [{ config_name: 'QUERIT_ENABLED', config_value: 'true' }];

    expect(buildSearchRuntimeConfig(configs, { includeGoogle: false })).toEqual(
      { QUERIT_ENABLED: 'true' }
    );
    expect(isSearchConfigured(configs)).toBe(true);
  });

  it('prefers BYOK while retaining Google credentials for fallback', () => {
    const configs = [
      { config_name: 'QUERIT_ENABLED', config_value: 'true' },
      { config_name: 'QUERIT_API_KEY', config_value: 'querit-key' },
      { config_name: 'GOOGLE_API_KEY', config_value: 'google-key' },
      { config_name: 'SEARCH_ENGINE_ID', config_value: 'engine-id' },
    ];

    expect(buildSearchRuntimeConfig(configs, { includeGoogle: true })).toEqual({
      QUERIT_ENABLED: 'true',
      QUERIT_API_KEY: 'querit-key',
      GOOGLE_API_KEY: 'google-key',
      SEARCH_ENGINE_ID: 'engine-id',
    });
  });
});
