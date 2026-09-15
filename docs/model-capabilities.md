# Model effort capabilities

The backend resolves thinking effort through a versioned capability declaration
before admitting a Run. The resolved provider value and transport are recorded in
the environment specification and used when constructing the model. An explicitly
requested unsupported effort is rejected instead of silently becoming `medium`.

## Capability sources

Resolution uses the first applicable source:

1. A provider/model-scoped `extra_params.model_capability` override.
1. An exact provider/model entry in the catalog, except for Codex subscription
   authentication, which retains its existing adapter mapping.
1. The Codex subscription adapter or the legacy OpenAI/Azure adapter rules.
1. An unknown-model result when no capability has been registered.

The built-in catalog is
`backend/app/workspace_config/model_capabilities.json`. Set
`EIGENT_MODEL_CAPABILITY_CATALOG` to a complete replacement catalog to register
additional models without changing Python code. A replacement is not merged with
the built-in catalog. Loading the catalog does not call a provider.

Catalog entries match `model_platform` and `model_type` after trimming whitespace
and normalizing case. Azure deployment aliases need their own exact entry or
scoped override; their capabilities are not inferred from the alias.

The built-in `gpt-6-astra` entries for OpenAI and Azure preserve all five effort
values, including `max`. They select Responses when tools are present. These are
application declarations; the mocked tests do not establish support for a
particular live Azure deployment. Consult the provider's model/deployment contract
before registering a deployment.

Legacy OpenAI/Azure prefix rules remain compatibility fallbacks. New models should
use a catalog entry or override. The existing Codex subscription mapping of
`max` to `xhigh` is unchanged. The historical product alias `ultra` normalizes to
the product effort `max`; `ultra` is not forwarded as a provider value.

## Declaration format

The following example registers a fictitious deployment. Its supported values
must be replaced with the deployment's actual contract.

```json
{
  "schema_version": 1,
  "revision": "example-catalog-v1",
  "models": [
    {
      "schema_version": 1,
      "revision": "example-deployment-v1",
      "model_platform": "azure",
      "model_type": "example-deployment",
      "supported_efforts": ["low", "medium", "high", "xhigh", "max"],
      "default_effort": "medium",
      "provider_mapping": {
        "low": "low",
        "medium": "medium",
        "high": "high",
        "xhigh": "xhigh",
        "max": "max"
      },
      "transport_parameters": {
        "chat_completions": "reasoning_effort",
        "responses": "reasoning.effort"
      },
      "default_transport": "chat_completions",
      "tools_transport": "responses"
    }
  ]
}
```

For a request-specific override, put the individual object from `models` under
`extra_params.model_capability`. Do not include the surrounding catalog object.
This reserved initializer field is consumed locally and never forwarded to CAMEL
or the provider request body. It must match the selected provider/model. Do not put
credentials, endpoint URLs, or local paths in capability metadata.

Both catalog and entry schemas reject unknown fields. Entries require unique
supported efforts, a supported default, a complete provider mapping, and a valid
parameter name for every declared transport. Provider values are restricted to
`low`, `medium`, `high`, `xhigh`, and `max`. Revisions contain only letters, digits,
periods, underscores, and hyphens. Invalid metadata produces a configuration error
without echoing its raw values or local catalog path.

## Admission and provider requests

Task admission assumes agents can use function tools and pins a compatible
transport. The runtime capability manifest records the capability source,
revision, supported values, mapping, selected transport, and any unknown-model
diagnostic. These fields contain no credentials.

When an unknown model has an explicit thinking effort, admission fails with a
structured HTTP 422 `unsupported_thinking_effort` response. If effort was omitted,
the model may use its provider default and the snapshot reports `unknown_model`.
The existing persisted `medium` enum remains a compatibility sentinel in that
case; `provider_default` and the diagnostic indicate that no specific effort was
established or sent. Invalid capability metadata returns HTTP 422
`invalid_model_capability`.

At model construction, the admitted effort takes precedence over conflicting
effort fields in provider configuration, including `extra_body`. The helper
normalizes the supported effort locations into the selected transport:

| Transport        | Provider request field |
| ---------------- | ---------------------- |
| Chat Completions | `reasoning_effort`     |
| Responses        | `reasoning.effort`     |

Responses-only reasoning options, such as a summary, remain in the Responses
`reasoning` object. They are rejected for Chat Completions. Responses requests drop
Chat-specific `stream_options`. An `extra_body.model` override is rejected because
it would invalidate the capability scope. Conflicting unpinned effort values or
unregistered raw provider effort values are also rejected.

A custom agent model resolves its own effort. It does not inherit the task's
admitted effort; a provider/model/endpoint change also discards an inherited
capability override unless the custom agent supplied its own initializer settings.
An explicitly supplied override must still match that agent's provider/model.
Responses instruction and input/image conversion remain owned by their existing
adapters, outside the effort helper.

## Revisions and resume

The capability digest includes the selected source, provider/model, authentication
source, mappings, transport, metadata, and applicable catalog revision. Changes to
these inputs can invalidate the existing resume capability check, including for
attempts created with an older capability digest format. This change does not
rewrite historical attempts or bypass that check. Start a new Run when an older
attempt cannot satisfy the current capability contract.

## Mock verification

Use the backend's installed Python environment and run from `backend`:

```sh
python -B tests/run_isolated.py --fast-test-mode \
  tests/app/workspace_config \
  tests/app/model/test_effort.py \
  tests/app/model/test_model_platform.py \
  tests/app/model/test_codex_subscription_runtime.py \
  tests/app/agent/test_agent_model.py \
  tests/app/agent/test_model_effort_pipeline.py \
  tests/app/run_journal/test_model_capture.py \
  tests/app/run_journal/test_model_invocations.py \
  tests/app/controller/test_model_effort_admission.py \
  tests/app/controller/test_chat_controller.py \
  tests/app/controller/test_run_stream_lifecycle.py \
  tests/app/workspace_bundle/test_workspace_bundle_runtime.py \
  tests/app/component/test_model_validation.py \
  tests/app/controller/test_model_controller.py -q -rs
```

The runner redirects user-state lookups to a temporary directory, disables dotenv
loading and model telemetry, and blocks in-process socket connections and DNS. It
is intended for unit/mock suites and does not sandbox subprocesses. The pipeline
tests use the real CAMEL adapter and OpenAI SDK with `httpx.MockTransport`; they
check synchronous and asynchronous request serialization without live provider
calls. Live deployment behavior and human acceptance require separate validation.
