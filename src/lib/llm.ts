import { Provider } from "@/types";

export const INIT_PROVODERS: Provider[] = [
  {
    id: 'gemini',
    name: 'Gemini',
    apiKey: '',
    apiHost: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    description: "Google Gemini model configuration.",
    is_valid: false,
    model_type: ""
  },
  {
    id: "openai",
    name: "OpenAI",
    apiKey: "",
    apiHost: "https://api.openai.com/v1",
    description: "OpenAI model configuration.",
    is_valid: false,
    model_type: ""
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    apiKey: '',
    apiHost: 'https://api.anthropic.com/v1/',
    description: "Anthropic Claude API configuration",
    is_valid: false,
    model_type: ""
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    apiKey: '',
    apiHost: 'https://openrouter.ai/api/v1',
    description: "OpenRouter model configuration.",
    is_valid: false,
    model_type: ""
  },
  {
    id: 'tongyi-qianwen',
    name: 'Qwen',
    apiKey: '',
    apiHost: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    description: "Qwen model configuration.",
    is_valid: false,
    model_type: ""
  },
  {
    id: 'deepseek',
    name: 'Deepseek',
    apiKey: '',
    apiHost: 'https://api.deepseek.com',
    description: "DeepSeek model configuration.",
    is_valid: false,
    model_type: ""
  },
  {
    id: 'minimax',
    name: 'Minimax',
    apiKey: '',
    apiHost: 'https://api.minimax.io/v1',
    description: "Minimax model configuration.",
    is_valid: false,
    model_type: ""
  },
  {
    id: 'Z.ai',
    name: 'Z.ai',
    apiKey: '',
    apiHost: 'https://api.z.ai/api/coding/paas/v4/',
    description: "Z.ai model configuration.",
    is_valid: false,
    model_type: ""
  },
  {
    id: 'moonshot',
    name: 'Moonshot',
    apiKey: '',
    apiHost: 'https://api.moonshot.cn/v1',
    description: "Kimi model configuration.",
    is_valid: false,
    model_type: ""
  },
  {
    id: 'ModelArk',
    name: 'ModelArk',
    apiKey: '',
    apiHost: 'https://ark.ap-southeast.bytepluses.com/api/v3',
    description: "ModelArk model configuration.",
    is_valid: false,
    model_type: ""
  },
  {
    id: 'aws-bedrock',
    name: 'AWS Bedrock',
    apiKey: '',
    apiHost: '',
    description: "AWS Bedrock model configuration.",
    hostPlaceHolder: "e.g. https://bedrock-runtime.{{region}}.amazonaws.com",
    is_valid: false,
    model_type: ""
  },
  {
    id: 'azure',
    name: 'Azure',
    apiKey: '',
    apiHost: '',
    description: "Azure OpenAI model configuration.",
    hostPlaceHolder: "e.g.https://{{your-resource-name}}.openai.azure.com",
    externalConfig: [
      {
        key: "api_version",
        name: "API Version",
        value: ""
      },
      {
        key: "azure_deployment_name",
        name: "Deployment Name",
        value: ""
      }
    ],
    is_valid: false,
    model_type: ""
  },
  {
    id: 'openai-compatible-model',
    name: 'OpenAI Compatible',
    apiKey: '',
    apiHost: '',
    description: "OpenAI-compatible API endpoint configuration.",
    hostPlaceHolder: "e.g. https://api.x.ai/v1",
    is_valid: false,
    model_type: ""
  }
]
