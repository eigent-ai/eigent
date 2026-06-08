---
title: Provider reference
description: Review every cloud and local model provider supported by Eigent.
icon: list
---

Eigent supports multiple provider types so open-source deployments can choose models based on capability, cost, privacy, and infrastructure.

Provider availability and required fields are defined by the current application. Use this page as an overview and the provider's official documentation for account, model, and billing details.

## Cloud and BYOK providers

| Provider             | Typical required values                    | Notes                                 |
| -------------------- | ------------------------------------------ | ------------------------------------- |
| Google Gemini        | API key, endpoint, model                   | Google model family                   |
| OpenAI               | API key, endpoint, model                   | OpenAI API                            |
| Anthropic            | API key, endpoint, model                   | Claude model family                   |
| OrcaRouter           | API key, endpoint                          | Can load a grouped model catalog      |
| OpenRouter           | API key, endpoint, model                   | Routes models from multiple providers |
| Qwen                 | API key, endpoint, model                   | Tongyi Qianwen provider               |
| DeepSeek             | API key, endpoint, model                   | DeepSeek model family                 |
| MiniMax              | API key, endpoint, model                   | MiniMax model family                  |
| Z.ai                 | API key, endpoint, model                   | Z.ai model family                     |
| Moonshot             | API key, endpoint, model                   | Moonshot model family                 |
| ModelArk             | API key, endpoint, model                   | ModelArk service                      |
| SambaNova            | API key, endpoint, model                   | SambaNova hosted inference            |
| Grok                 | API key, endpoint, model                   | xAI model family                      |
| Mistral              | API key, endpoint, model                   | Mistral model family                  |
| AWS Bedrock          | Region, access key, secret, model          | Optional session token                |
| AWS Bedrock Converse | Region, access key, secret, model          | Uses Bedrock Converse integration     |
| Microsoft Azure      | API key, endpoint, API version, deployment | Deployment name is required           |
| Baidu ERNIE          | API key, endpoint, model                   | ERNIE model family                    |
| OpenAI-compatible    | Endpoint, optional key, model              | For compatible third-party services   |

<Note>
Provider fields can change. Confirm required values in **Agents > Models** after updating Eigent.
</Note>

## Local runtimes

| Runtime   | Default endpoint            | Model discovery                             |
| --------- | --------------------------- | ------------------------------------------- |
| Ollama    | `http://localhost:11434/v1` | Reads the Ollama tags API                   |
| vLLM      | `http://localhost:8000/v1`  | Enter the served model when not listed      |
| SGLang    | `http://localhost:30000/v1` | Enter the served model when not listed      |
| LM Studio | `http://localhost:1234/v1`  | Enter the loaded model when not listed      |
| LLaMA.cpp | `http://localhost:8080/v1`  | Reads the OpenAI-compatible models endpoint |

## Configure a cloud provider

1. Create an account with the provider.
2. Create a restricted API credential.
3. Confirm the provider endpoint and model identifier.
4. In Eigent, open **Agents > Models**.
5. Select the provider and enter the values.
6. Validate and save.
7. Run a small test task.

## Configure an OpenAI-compatible endpoint

Use the OpenAI-compatible provider for services that implement compatible chat APIs.

Provide:

- Base endpoint
- API key when required
- Exact model identifier exposed by the service

Compatibility can vary. Test streaming, tool calls, and structured responses before using the provider for production work.

## Configure a local runtime

1. Install and start the runtime.
2. Load or serve a model.
3. Confirm the endpoint responds locally.
4. In Eigent, open **Agents > Models > Local**.
5. Select the runtime.
6. Enter the endpoint and model.
7. Validate and enable it.

> **Screenshot placeholder:** Add a composite screenshot showing one cloud provider form, Azure provider-specific fields, and one local runtime form. Blur credentials.

> **Video placeholder:** Add a 90-second MP4 showing an Ollama model and an OpenAI-compatible cloud endpoint being configured and tested. Include captions.

## Provider page checklist

Each dedicated provider guide should include:

1. Account or runtime prerequisites
2. Credential creation
3. Endpoint format
4. Model identifier examples
5. Eigent configuration
6. Validation
7. Common errors
8. Billing and privacy notes

## Security guidance

- Do not include credentials in screenshots, logs, or issue reports.
- Use least-privilege cloud credentials.
- Restrict local endpoints to trusted networks.
- Rotate keys after accidental exposure.
- Review the provider's data-retention policy.

## Related guides

- [Bring Your Own Key](/core/models/byok)
- [Local models](/core/models/local-model)
- [Self-hosting](/get_started/self-hosting)
