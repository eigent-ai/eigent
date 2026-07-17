---
title: Eigent Cloud models
description: Use managed models and credits without configuring provider API keys.
icon: cloud
---

Eigent Cloud provides managed model access for users who do not want to configure provider credentials or local inference.

## When to use Eigent Cloud

Choose Eigent Cloud when you want:

- The fastest setup path
- A curated model catalog
- No provider API-key management
- Usage tracked through Eigent credits
- A managed fallback while testing BYOK or local models

## Enable a Cloud model

1. Open **Agents > Models**.
2. Select **Cloud**.
3. Review the available models.
4. Select the model to use.
5. Enable Cloud and mark it as preferred when it should be the default.

> **Screenshot placeholder:** Add a screenshot of the Cloud model catalog and preferred-model control. Use an account with non-sensitive sample credit data.

## Available model families

The current application catalog can include managed options from:

- Google Gemini
- OpenAI
- Anthropic Claude
- DeepSeek
- MiniMax

Exact models can change as providers release new versions. Treat the in-product catalog as the source of truth for current availability.

## Understand credits

Cloud usage consumes Eigent credits. Credit consumption depends on the selected model and task usage.

The product can show:

- Current plan
- Available credit balance
- Links for plan management
- Model availability based on the account

Review the current pricing and plan page before running large or automated workloads.

## Change the Cloud model

1. Open the Cloud model selector.
2. Choose another available model.
3. Save or apply the selection.

New tasks use the new preference. Running tasks are not migrated automatically.

## Use Cloud with other providers

You can keep Cloud enabled while also configuring BYOK and local providers. Mark one provider as preferred, then select another model for individual tasks when needed.

This supports workflows such as:

- Cloud as the default, local model for private files
- BYOK as the default, Cloud as a fallback
- Different model families for coding, research, and writing

> **Video placeholder:** Add a 45-second MP4 showing Cloud model selection, preferred-provider changes, and selecting a different model for a new task. Include captions.

## Troubleshooting

### No Cloud models are available

Confirm the account is signed in, the application can reach Eigent services, and the current plan includes model access.

### Credits are unavailable

Open account management to review the plan or add credits.

### The selected model changed

Model availability can change. Open the Cloud catalog and select another supported model.

## Related guides

- [Models overview](/models/overview)
- [Provider reference](/models/provider-reference)
- [Privacy](/settings/privacy)
