---
title: Models
description: Configure and deploy your preferred LLM models with Eigent.
icon: server
---

Eigent supports flexible integration and deployment of top LLMs and multimodal models. You can follow the steps below to set up your preferred LLM models.

1. Click Settings

![click_settings](/docs/images/models_settings.png)

2. Close Eigent Cloud Version

![close_eigent](/docs/images/models_close.png)

3. Configure your APIKEY and Model Type

![configure_api](/docs/images/models_configure_models.png)

4. Configure the Google Search toolkit

![configure_searchtools](/docs/images/models_configure_tools.png)

![configure_searchtoolsapi](/docs/images/models_configure_tools_key.png)

You can refer to the following document for detailed information on how to configure **GOOGLE_API_KEY** and **SEARCH_ENGINE_ID :** https://developers.google.com/custom-search/v1/overview

Now，start enjoying Eigent！

## **Self-Host Model**

1. Configure your self-host model

First, you need to set up your local models and expose them as an **OpenAI-Compatible Server.**

```bash
#Vllm https://docs.vllm.ai/en/latest/getting_started/quickstart.html#openai-compatible-server
vllm serve Qwen/Qwen2.5-1.5B-Instruct
```

```python
#Sglang https://docs.sglang.ai/backend/openai_api_completions.html
from sglang.test.test_utils import is_in_ci

if is_in_ci():
    from patch import launch_server_cmd
else:
    from sglang.utils import launch_server_cmd

from sglang.utils import wait_for_server, print_highlight, terminate_process

server_process, port = launch_server_cmd(
    "python3 -m sglang.launch_server --model-path qwen/qwen2.5-0.5b-instruct --host 0.0.0.0 --mem-fraction-static 0.8"
)

wait_for_server(f"http://localhost:{port}")
print(f"Server started on http://localhost:{port}")
```

```bash
#Ollama https://github.com/ollama/ollama
ollama pull qwen2.5:7b
```

2. Setting your model

![set_local_model](/docs/images/models_local_model.png)

3. Configure the Google Search toolkit

![configure_searchtools](/docs/images/models_configure_tools.png)

![configure_searchtoolsapi](/docs/images/models_configure_tools_key.png)
You can refer to the following document for detailed information on how to configure **GOOGLE_API_KEY** and **SEARCH_ENGINE_ID :** https://developers.google.com/custom-search/v1/overview

## **API KEY Reference**

Gemini: https://ai.google.dev/gemini-api/docs/api-key

OpenAI: https://platform.openai.com/api-keys

Anthropic: https://console.anthropic.com/

Qwen:https://www.alibabacloud.com/help/en/model-studio/get-api-key

Deepseek: https://platform.deepseek.com/api_keys

AWS Bedrock:https://github.com/aws-samples/bedrock-access-gateway/blob/main/README.md

Azure:https://azure.microsoft.com/products/cognitive-services/openai-service/