---
title: Models overview
description: Choose between Eigent Cloud, your own provider keys, and local inference servers.
icon: brain
---

Eigent is model-flexible by design. You can use managed Eigent Cloud models, connect provider accounts with your own keys, or run open models on local infrastructure.

At least one valid model is required before Eigent can start a task.

## Open Models

1. Open the Eigent dashboard.
2. Select **Agents**.
3. Select **Models**.

The Models page separates managed cloud, bring-your-own-key, and local providers.

> **Screenshot placeholder:** Add a screenshot of the Models page with the Cloud, BYOK, and Local sections visible. Hide all credential values.

## Choose a model source

### Eigent Cloud

Use managed models without configuring provider credentials. This is the quickest way to evaluate Eigent and is billed through Eigent credits.

### Bring Your Own Key

Connect a supported cloud provider with your own API key and endpoint. Provider billing and data handling follow the provider account.

### Local models

Connect Eigent to Ollama, vLLM, SGLang, LM Studio, or LLaMA.cpp. Local models can keep inference on infrastructure you control.

## Configure a provider

1. Select the provider.
2. Enter the required key, endpoint, model name, and provider-specific fields.
3. Validate or save the configuration.
4. Enable the provider.
5. Optional: Mark it as preferred.

Some providers can load their model catalog dynamically. Others require a model name.

## Select a default model

The preferred provider becomes the default choice for new tasks. You can also choose a model from the task composer when model selection is available there.

Changing the default affects future tasks. It does not replace the model already used by an active Run.

## Compare model options

Consider:

- Reasoning quality
- Tool-use reliability
- Context window
- Input and output modalities
- Latency
- Cost
- Data residency
- Local hardware requirements

Use a representative task to validate a model before making it the default for all work.

> **Video placeholder:** Add a 60-second MP4 showing one BYOK provider and one local runtime being configured, validated, enabled, and selected. Include captions.

## Remove a provider

1. Open the provider.
2. Disable it.
3. Select the delete or reset action.
4. Confirm the removal.

Removing a provider deletes its stored Eigent configuration. It does not delete the provider account or local model.

## Troubleshooting

### Validation fails

Check the key, endpoint, model name, provider region, API version, and network proxy.

### No local models appear

Confirm the local runtime is running and supports model listing. Some runtimes require entering the model name manually.

### A task still uses another model

Confirm the preferred provider and the model selected in the task composer. Existing active Runs keep their current configuration.

## Related guides

- [Eigent Cloud models](/models/eigent-cloud)
- [Bring Your Own Key](/core/models/byok)
- [Local models](/core/models/local-model)
- [Provider reference](/models/provider-reference)
