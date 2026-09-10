import { describe, expect, it } from '@jest/globals'
import { buildLocalResources, fetchRemoteResources, getApiEndpoint } from './resources.js'
import { reconcile } from './reconcile.js'
import { buildNotificationProviderDefinitions } from '../commands/pull.js'
import type { ApiClient } from '../api/client.js'
import type { SupercheckConfig } from '../config/schema.js'

function paginatedEmptyResponse() {
  return {
    data: {
      data: [],
      pagination: { totalPages: 1 },
    },
  }
}

describe('notification provider resources', () => {
  it('includes notification providers in local resources', () => {
    const config: SupercheckConfig = {
      schemaVersion: '1.0',
      project: { organization: 'org-id', project: 'project-id' },
      notificationProviders: [
        {
          id: '019efa02-c173-7608-9c9d-7e5bc3661fb8',
          name: 'VictorOps',
          type: 'webhook',
          config: {
            url: 'https://alert.victorops.com/integrations/generic/20131114/alert/key/route',
            method: 'POST',
            bodyTemplate: '{"message_type":"{{victorOpsMessageType}}"}',
          },
        },
      ],
    }

    expect(buildLocalResources(config, process.cwd())).toEqual([
      {
        id: '019efa02-c173-7608-9c9d-7e5bc3661fb8',
        type: 'notificationProvider',
        name: 'VictorOps',
        definition: {
          id: '019efa02-c173-7608-9c9d-7e5bc3661fb8',
          name: 'VictorOps',
          type: 'webhook',
          config: {
            url: 'https://alert.victorops.com/integrations/generic/20131114/alert/key/route',
            method: 'POST',
            bodyTemplate: '{"message_type":"{{victorOpsMessageType}}"}',
          },
        },
      },
    ])
  })

  it('detects webhook bodyTemplate drift', () => {
    const local = [
      {
        id: '019efa02-c173-7608-9c9d-7e5bc3661fb8',
        type: 'notificationProvider' as const,
        name: 'VictorOps',
        definition: {
          id: '019efa02-c173-7608-9c9d-7e5bc3661fb8',
          name: 'VictorOps',
          type: 'webhook',
          config: {
            url: 'https://alert.victorops.com/integrations/generic/20131114/alert/key/route',
            method: 'POST',
            bodyTemplate: '{"abcd":"{{alertAction}}"}',
          },
        },
      },
    ]
    const remote = [
      {
        id: '019efa02-c173-7608-9c9d-7e5bc3661fb8',
        type: 'notificationProvider' as const,
        name: 'VictorOps',
        raw: {
          id: '019efa02-c173-7608-9c9d-7e5bc3661fb8',
          name: 'VictorOps',
          type: 'webhook',
          config: {
            url: 'https://alert.victorops.com/integrations/generic/20131114/alert/key/route',
            method: 'POST',
            bodyTemplate: '{"message_type":"{{alertAction}}"}',
          },
        },
      },
    ]

    expect(reconcile(local, remote)).toMatchObject([
      {
        action: 'update',
        type: 'notificationProvider',
        id: '019efa02-c173-7608-9c9d-7e5bc3661fb8',
      },
    ])
  })

  it('ignores masked secret fields while detecting bodyTemplate drift', () => {
    const local = [
      {
        id: '019efa02-c173-7608-9c9d-7e5bc3661fb8',
        type: 'notificationProvider' as const,
        name: 'VictorOps',
        definition: {
          id: '019efa02-c173-7608-9c9d-7e5bc3661fb8',
          name: 'VictorOps',
          type: 'webhook',
          config: {
            url: 'https://alert.victorops.com/integrations/generic/20131114/alert/key/route',
            method: 'POST',
            bodyTemplate: '{"abcd":"{{alertAction}}"}',
          },
        },
      },
    ]
    const remote = [
      {
        id: '019efa02-c173-7608-9c9d-7e5bc3661fb8',
        type: 'notificationProvider' as const,
        name: 'VictorOps',
        raw: {
          id: '019efa02-c173-7608-9c9d-7e5bc3661fb8',
          name: 'VictorOps',
          type: 'webhook',
          __maskedFields: ['url'],
          config: {
            url: 'https://alert.victorops.com/integrations/generic/20131114/alert...route',
            method: 'POST',
            bodyTemplate: '{"message_type":"{{alertAction}}"}',
          },
        },
      },
    ]

    const [change] = reconcile(local, remote)

    expect(change).toMatchObject({ action: 'update', type: 'notificationProvider' })
    expect(change.details).toHaveLength(1)
    expect(change.details?.[0]).toContain('bodyTemplate')
    expect(change.details?.[0]).not.toContain('victorops.com')
  })

  it('fetches remote notification providers for reconciliation', async () => {
    const client = {
      get: async (endpoint: string) => {
        if (endpoint === '/api/notification-providers') {
          return {
            data: [
              {
                id: '019efa02-c173-7608-9c9d-7e5bc3661fb8',
                name: 'VictorOps',
                type: 'webhook',
                config: {
                  bodyTemplate: '{"message_type":"{{alertAction}}"}',
                },
                maskedFields: ['url'],
                lastUsed: null,
              },
            ],
          }
        }

        if (endpoint === '/api/variables' || endpoint === '/api/tags') {
          return { data: [] }
        }

        return paginatedEmptyResponse()
      },
    } as unknown as ApiClient

    await expect(fetchRemoteResources(client)).resolves.toContainEqual({
      id: '019efa02-c173-7608-9c9d-7e5bc3661fb8',
      type: 'notificationProvider',
      name: 'VictorOps',
      raw: {
        id: '019efa02-c173-7608-9c9d-7e5bc3661fb8',
        name: 'VictorOps',
        type: 'webhook',
        __maskedFields: ['url'],
        config: {
          name: 'VictorOps',
          bodyTemplate: '{"message_type":"{{alertAction}}"}',
        },
      },
    })
  })

  it('maps notification providers to the provider API endpoint', () => {
    expect(getApiEndpoint('notificationProvider')).toBe('/api/notification-providers')
  })

  it('pull strips masked secret fields from notification provider configs', () => {
    const providers = [
      {
        id: '019efa02-c173-7608-9c9d-7e5bc3661fb8',
        name: 'VictorOps',
        type: 'webhook',
        config: {
          url: 'https://alert.victorops.com/integrations/generic/20131114/alert...route',
          headers: {},
          method: 'POST',
          bodyTemplate: '{"message_type":"{{alertAction}}"}',
        },
        maskedFields: ['url', 'headers'],
      },
    ]

    const defs = buildNotificationProviderDefinitions(providers)

    expect(defs[0].config).toEqual({
      name: 'VictorOps',
      method: 'POST',
      bodyTemplate: '{"message_type":"{{alertAction}}"}',
    })
  })

  it('pull adds config.name when it is missing', () => {
    const providers = [
      {
        id: '019efa02-c173-7608-9c9d-7e5bc3661fb8',
        name: 'VictorOps',
        type: 'webhook',
        config: {
          method: 'POST',
        },
        maskedFields: [],
      },
    ]

    const defs = buildNotificationProviderDefinitions(providers)

    expect(defs[0].config).toEqual({
      name: 'VictorOps',
      method: 'POST',
    })
  })

  it('reports no diff for a pulled config round-trip', () => {
    const pulledConfig = buildNotificationProviderDefinitions([
      {
        id: '019efa02-c173-7608-9c9d-7e5bc3661fb8',
        name: 'VictorOps',
        type: 'webhook',
        config: {
          url: 'https://alert.victorops.com/integrations/generic/20131114/alert...route',
          method: 'POST',
          bodyTemplate: '{"message_type":"{{alertAction}}"}',
        },
        maskedFields: ['url'],
      },
    ])[0]

    const local = [
      {
        id: '019efa02-c173-7608-9c9d-7e5bc3661fb8',
        type: 'notificationProvider' as const,
        name: 'VictorOps',
        definition: pulledConfig,
      },
    ]

    const remote = [
      {
        id: '019efa02-c173-7608-9c9d-7e5bc3661fb8',
        type: 'notificationProvider' as const,
        name: 'VictorOps',
        raw: {
          id: '019efa02-c173-7608-9c9d-7e5bc3661fb8',
          name: 'VictorOps',
          type: 'webhook',
          __maskedFields: ['url'],
          config: {
            name: 'VictorOps',
            method: 'POST',
            bodyTemplate: '{"message_type":"{{alertAction}}"}',
          },
        },
      },
    ]

    expect(reconcile(local, remote)).toMatchObject([
      { action: 'no-change', type: 'notificationProvider' },
    ])
  })

  it('detects explicit secret rotation without exposing the new secret in diff output', () => {
    const local = [
      {
        id: '019efa02-c173-7608-9c9d-7e5bc3661fb8',
        type: 'notificationProvider' as const,
        name: 'VictorOps',
        definition: {
          id: '019efa02-c173-7608-9c9d-7e5bc3661fb8',
          name: 'VictorOps',
          type: 'webhook',
          config: {
            name: 'VictorOps',
            url: 'https://alert.victorops.com/integrations/generic/20131114/alert/new-secret/route',
            method: 'POST',
            bodyTemplate: '{"message_type":"{{alertAction}}"}',
          },
        },
      },
    ]
    const remote = [
      {
        id: '019efa02-c173-7608-9c9d-7e5bc3661fb8',
        type: 'notificationProvider' as const,
        name: 'VictorOps',
        raw: {
          id: '019efa02-c173-7608-9c9d-7e5bc3661fb8',
          name: 'VictorOps',
          type: 'webhook',
          __maskedFields: ['url'],
          config: {
            name: 'VictorOps',
            url: 'https://alert.victorops.com/integrations/generic/20131114/alert...route',
            method: 'POST',
            bodyTemplate: '{"message_type":"{{alertAction}}"}',
          },
        },
      },
    ]

    const [change] = reconcile(local, remote)

    expect(change).toMatchObject({ action: 'update', type: 'notificationProvider' })
    expect(change.details?.join('\n')).toContain('[local secret provided]')
    expect(change.details?.join('\n')).not.toContain('new-secret')
  })
})
