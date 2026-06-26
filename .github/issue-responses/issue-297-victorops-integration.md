Hi @pausauer, thanks for the clear VictorOps/Splunk On-Call lifecycle details.

We added dedicated webhook template variables for Splunk On-Call/VictorOps:

- `{{victorOpsMessageType}}`
- `{{splunkOnCallMessageType}}`

These render as `CRITICAL` for trigger/failure alerts and `RECOVERY` for monitor recovery alerts. Use the stable `{{dedupKey}}` as `entity_id` so Splunk On-Call can correlate the recovery with the original incident.

Example template:

```json
{
  "message_type": "{{victorOpsMessageType}}",
  "entity_id": "{{dedupKey}}",
  "entity_display_name": "{{title}}",
  "state_message": "{{message}}",
  "monitoring_tool": "supercheck",
  "timestamp": "{{timestamp}}"
}
```

The alert documentation has been updated with the full VictorOps/Splunk On-Call example.
