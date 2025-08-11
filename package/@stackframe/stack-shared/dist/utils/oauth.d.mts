declare const standardProviders: readonly ["google", "github", "microsoft", "spotify", "facebook", "discord", "gitlab", "bitbucket", "linkedin", "apple", "x"];
declare const sharedProviders: readonly ["google", "github", "microsoft", "spotify"];
declare const allProviders: readonly ["google", "github", "microsoft", "spotify", "facebook", "discord", "gitlab", "bitbucket", "linkedin", "apple", "x"];
type ProviderType = typeof allProviders[number];
type StandardProviderType = typeof standardProviders[number];
type SharedProviderType = typeof sharedProviders[number];

export { type ProviderType, type SharedProviderType, type StandardProviderType, allProviders, sharedProviders, standardProviders };
