Hi @jack-atlas, thanks for reporting this.

We fixed Azure OpenAI generation requests so Supercheck no longer sends the `temperature` parameter to Azure deployments by default. This avoids the Azure GPT-5/reasoning-model error:

```text
Unsupported parameter: 'temperature' is not supported with this model.
```

The change is centralized across the AI request paths, including test fixing, streaming generation, and requirement extraction. If a specific Azure deployment requires temperature support, it can be explicitly re-enabled with `AZURE_INCLUDE_TEMPERATURE=true`.

The self-hosted Azure configuration docs now also call out this optional flag.

This should let Azure GPT-5 deployments run without switching back to GPT-4o.
