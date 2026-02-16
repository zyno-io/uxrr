/**
 * Mock fixture data for VRT e2e tests.
 * All data shapes match the OpenAPI-generated types.
 */

import type {
    ISession,
    ILogEntry,
    IChatMessage,
    IRrwebEvent,
    AppResponse,
    UserResponse,
    ApiKeyResponse,
    AuthConfigResponse,
    MeResponse
} from '../../src/openapi-client-generated';

// ─── Timestamps ──────────────────────────────────────────────────────
const BASE_TS = new Date('2025-06-15T14:30:00Z').getTime();

/** Fixed "now" for VRT clock — 2 minutes after BASE_TS. */
export const VRT_NOW = new Date(BASE_TS + 120_000);

function ts(offsetMs: number): string {
    return new Date(BASE_TS + offsetMs).toISOString();
}

// ─── Sessions ────────────────────────────────────────────────────────
export const sessions: ISession[] = [
    {
        id: 'sess-recorded-chat',
        appId: 'my-app',
        deviceId: 'device-abc123',
        userId: 'user-42',
        userName: 'Jane Doe',
        userEmail: 'jane@example.com',
        version: '2.1.0',
        environment: 'production',
        userAgent:
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        ipAddress: '192.168.1.42',
        startedAt: ts(0),
        lastActivityAt: ts(120_000),
        eventChunkCount: 3,
        hasChatMessages: true,
        createdAt: ts(0),
        updatedAt: ts(120_000),
        allUserIds: ['user-42'],
        isLive: false
    },
    {
        id: 'sess-live-001',
        appId: 'my-app',
        deviceId: 'device-def456',
        userId: 'user-99',
        userName: 'Bob Smith',
        userEmail: 'bob@example.com',
        version: '2.1.0',
        environment: 'staging',
        userAgent:
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        ipAddress: '10.0.0.5',
        startedAt: ts(-60_000),
        lastActivityAt: ts(0),
        eventChunkCount: 0,
        hasChatMessages: false,
        createdAt: ts(-60_000),
        updatedAt: ts(0),
        allUserIds: ['user-99'],
        isLive: true
    },
    {
        id: 'sess-basic-002',
        appId: 'other-app',
        deviceId: 'device-ghi789',
        version: '1.0.0',
        environment: 'development',
        userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
        ipAddress: '172.16.0.1',
        startedAt: ts(-300_000),
        lastActivityAt: ts(-240_000),
        eventChunkCount: 1,
        hasChatMessages: false,
        createdAt: ts(-300_000),
        updatedAt: ts(-240_000),
        allUserIds: [],
        isLive: false
    }
];

// ─── rrweb Events ────────────────────────────────────────────────────
// Minimal valid set: type 4 (Meta) + type 2 (FullSnapshot)
export const rrwebEvents: IRrwebEvent[] = [
    {
        type: 4,
        data: { href: 'https://example.com/dashboard', width: 1280, height: 720 },
        timestamp: BASE_TS
    },
    {
        type: 2,
        data: {
            node: {
                type: 0,
                childNodes: [
                    {
                        type: 1,
                        name: 'html',
                        publicId: '',
                        systemId: '',
                        id: 1
                    },
                    {
                        type: 2,
                        tagName: 'html',
                        attributes: { lang: 'en' },
                        childNodes: [
                            {
                                type: 2,
                                tagName: 'head',
                                attributes: {},
                                childNodes: [
                                    {
                                        type: 2,
                                        tagName: 'title',
                                        attributes: {},
                                        childNodes: [{ type: 3, textContent: 'My App', id: 4 }],
                                        id: 3
                                    }
                                ],
                                id: 2
                            },
                            {
                                type: 2,
                                tagName: 'body',
                                attributes: {
                                    style: 'margin:0;background:#f5f5f5'
                                },
                                childNodes: [
                                    {
                                        type: 2,
                                        tagName: 'div',
                                        attributes: { id: 'app' },
                                        childNodes: [
                                            {
                                                type: 2,
                                                tagName: 'header',
                                                attributes: {
                                                    style: 'background:#2563eb;color:#fff;padding:16px 24px;font-family:sans-serif;font-size:18px'
                                                },
                                                childNodes: [
                                                    {
                                                        type: 3,
                                                        textContent: 'My App Dashboard',
                                                        id: 8
                                                    }
                                                ],
                                                id: 7
                                            },
                                            {
                                                type: 2,
                                                tagName: 'main',
                                                attributes: {
                                                    style: 'padding:24px;font-family:sans-serif'
                                                },
                                                childNodes: [
                                                    {
                                                        type: 2,
                                                        tagName: 'h1',
                                                        attributes: {
                                                            style: 'margin:0 0 16px;font-size:24px;color:#1e293b'
                                                        },
                                                        childNodes: [
                                                            {
                                                                type: 3,
                                                                textContent: 'Welcome back, Jane',
                                                                id: 11
                                                            }
                                                        ],
                                                        id: 10
                                                    },
                                                    {
                                                        type: 2,
                                                        tagName: 'div',
                                                        attributes: {
                                                            style: 'display:grid;grid-template-columns:repeat(3,1fr);gap:16px'
                                                        },
                                                        childNodes: [
                                                            {
                                                                type: 2,
                                                                tagName: 'div',
                                                                attributes: {
                                                                    style: 'background:#fff;border-radius:8px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,.1)'
                                                                },
                                                                childNodes: [
                                                                    {
                                                                        type: 2,
                                                                        tagName: 'div',
                                                                        attributes: {
                                                                            style: 'color:#64748b;font-size:14px;margin-bottom:4px'
                                                                        },
                                                                        childNodes: [
                                                                            {
                                                                                type: 3,
                                                                                textContent: 'Total Users',
                                                                                id: 15
                                                                            }
                                                                        ],
                                                                        id: 14
                                                                    },
                                                                    {
                                                                        type: 2,
                                                                        tagName: 'div',
                                                                        attributes: {
                                                                            style: 'font-size:28px;font-weight:700;color:#1e293b'
                                                                        },
                                                                        childNodes: [
                                                                            {
                                                                                type: 3,
                                                                                textContent: '1,247',
                                                                                id: 17
                                                                            }
                                                                        ],
                                                                        id: 16
                                                                    }
                                                                ],
                                                                id: 13
                                                            },
                                                            {
                                                                type: 2,
                                                                tagName: 'div',
                                                                attributes: {
                                                                    style: 'background:#fff;border-radius:8px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,.1)'
                                                                },
                                                                childNodes: [
                                                                    {
                                                                        type: 2,
                                                                        tagName: 'div',
                                                                        attributes: {
                                                                            style: 'color:#64748b;font-size:14px;margin-bottom:4px'
                                                                        },
                                                                        childNodes: [
                                                                            {
                                                                                type: 3,
                                                                                textContent: 'Revenue',
                                                                                id: 20
                                                                            }
                                                                        ],
                                                                        id: 19
                                                                    },
                                                                    {
                                                                        type: 2,
                                                                        tagName: 'div',
                                                                        attributes: {
                                                                            style: 'font-size:28px;font-weight:700;color:#1e293b'
                                                                        },
                                                                        childNodes: [
                                                                            {
                                                                                type: 3,
                                                                                textContent: '$48,392',
                                                                                id: 22
                                                                            }
                                                                        ],
                                                                        id: 21
                                                                    }
                                                                ],
                                                                id: 18
                                                            },
                                                            {
                                                                type: 2,
                                                                tagName: 'div',
                                                                attributes: {
                                                                    style: 'background:#fff;border-radius:8px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,.1)'
                                                                },
                                                                childNodes: [
                                                                    {
                                                                        type: 2,
                                                                        tagName: 'div',
                                                                        attributes: {
                                                                            style: 'color:#64748b;font-size:14px;margin-bottom:4px'
                                                                        },
                                                                        childNodes: [
                                                                            {
                                                                                type: 3,
                                                                                textContent: 'Active Now',
                                                                                id: 25
                                                                            }
                                                                        ],
                                                                        id: 24
                                                                    },
                                                                    {
                                                                        type: 2,
                                                                        tagName: 'div',
                                                                        attributes: {
                                                                            style: 'font-size:28px;font-weight:700;color:#16a34a'
                                                                        },
                                                                        childNodes: [
                                                                            {
                                                                                type: 3,
                                                                                textContent: '89',
                                                                                id: 27
                                                                            }
                                                                        ],
                                                                        id: 26
                                                                    }
                                                                ],
                                                                id: 23
                                                            }
                                                        ],
                                                        id: 12
                                                    },
                                                    {
                                                        type: 2,
                                                        tagName: 'button',
                                                        attributes: {
                                                            style: 'margin-top:24px;background:#2563eb;color:#fff;border:none;padding:10px 20px;border-radius:6px;font-size:14px;cursor:pointer'
                                                        },
                                                        childNodes: [
                                                            {
                                                                type: 3,
                                                                textContent: 'View Reports',
                                                                id: 29
                                                            }
                                                        ],
                                                        id: 28
                                                    }
                                                ],
                                                id: 9
                                            }
                                        ],
                                        id: 6
                                    }
                                ],
                                id: 5
                            }
                        ],
                        id: 2
                    }
                ],
                id: 0
            },
            initialOffset: { top: 0, left: 0 }
        },
        timestamp: BASE_TS + 50
    },
    // Incremental mouse-move events to extend the player timeline past all logs
    {
        type: 3,
        data: { source: 1, positions: [{ x: 400, y: 300, id: 6, timeOffset: 0 }] },
        timestamp: BASE_TS + 10_000
    },
    {
        type: 3,
        data: { source: 1, positions: [{ x: 600, y: 350, id: 6, timeOffset: 0 }] },
        timestamp: BASE_TS + 20_000
    },
    {
        type: 3,
        data: { source: 1, positions: [{ x: 500, y: 400, id: 6, timeOffset: 0 }] },
        timestamp: BASE_TS + 25_000
    }
];

// ─── Console Logs ────────────────────────────────────────────────────
const SID = 'sess-recorded-chat';
const AID = 'my-app';
const DID = 'device-abc123';

export const consoleLogs: ILogEntry[] = [
    {
        t: BASE_TS + 100,
        v: 0,
        c: 'app',
        m: 'App initialized, loading user preferences',
        appId: AID,
        deviceId: DID,
        sessionId: SID
    },
    {
        t: BASE_TS + 500,
        v: 1,
        c: 'auth',
        m: 'User authenticated successfully',
        d: { userId: 'user-42', method: 'oidc' },
        appId: AID,
        deviceId: DID,
        sessionId: SID,
        userId: 'user-42'
    },
    {
        t: BASE_TS + 1200,
        v: 1,
        c: 'router',
        m: 'Navigated to /dashboard',
        appId: AID,
        deviceId: DID,
        sessionId: SID,
        userId: 'user-42'
    },
    {
        t: BASE_TS + 3000,
        v: 2,
        c: 'api',
        m: 'Slow response from /api/reports (2340ms)',
        d: { threshold: 1000, actual: 2340 },
        appId: AID,
        deviceId: DID,
        sessionId: SID,
        userId: 'user-42'
    },
    {
        t: BASE_TS + 5000,
        v: 3,
        c: 'api',
        m: 'Failed to fetch user notifications: 500 Internal Server Error',
        d: { url: '/api/notifications', status: 500, body: 'Internal Server Error' },
        appId: AID,
        deviceId: DID,
        sessionId: SID,
        userId: 'user-42'
    },
    {
        t: BASE_TS + 8000,
        v: 0,
        c: 'perf',
        m: 'LCP: 1240ms, FID: 12ms, CLS: 0.04',
        d: { lcp: 1240, fid: 12, cls: 0.04 },
        appId: AID,
        deviceId: DID,
        sessionId: SID,
        userId: 'user-42'
    },
    {
        t: BASE_TS + 15000,
        v: 1,
        c: 'app',
        m: 'User clicked "View Reports" button',
        appId: AID,
        deviceId: DID,
        sessionId: SID,
        userId: 'user-42'
    },
    {
        t: BASE_TS + 20000,
        v: 2,
        c: 'storage',
        m: 'localStorage quota nearly exceeded (4.8MB / 5MB)',
        appId: AID,
        deviceId: DID,
        sessionId: SID,
        userId: 'user-42'
    }
];

// ─── Network Logs ────────────────────────────────────────────────────
export const networkLogs: ILogEntry[] = [
    {
        t: BASE_TS + 200,
        v: 1,
        c: 'uxrr:net',
        m: 'GET /api/user/profile',
        d: {
            method: 'GET',
            url: 'https://example.com/api/user/profile',
            status: 200,
            duration: 145,
            requestHeaders: { Authorization: 'Bearer ***', Accept: 'application/json' },
            responseHeaders: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache'
            },
            responseBody: '{"id":"user-42","name":"Jane Doe","email":"jane@example.com"}'
        },
        appId: AID,
        deviceId: DID,
        sessionId: SID,
        userId: 'user-42'
    },
    {
        t: BASE_TS + 800,
        v: 1,
        c: 'uxrr:net',
        m: 'GET /api/dashboard/stats',
        d: {
            method: 'GET',
            url: 'https://example.com/api/dashboard/stats',
            status: 200,
            duration: 320
        },
        appId: AID,
        deviceId: DID,
        sessionId: SID,
        userId: 'user-42'
    },
    {
        t: BASE_TS + 2500,
        v: 1,
        c: 'uxrr:net',
        m: 'POST /api/analytics/event',
        d: {
            method: 'POST',
            url: 'https://example.com/api/analytics/event',
            status: 201,
            duration: 89,
            requestHeaders: { 'Content-Type': 'application/json' },
            requestBody: '{"event":"page_view","page":"/dashboard"}'
        },
        appId: AID,
        deviceId: DID,
        sessionId: SID,
        userId: 'user-42'
    },
    {
        t: BASE_TS + 4500,
        v: 1,
        c: 'uxrr:net',
        m: 'GET /api/notifications',
        d: {
            method: 'GET',
            url: 'https://example.com/api/notifications',
            status: 500,
            duration: 2340,
            responseBody: '{"error":"Internal Server Error"}'
        },
        appId: AID,
        deviceId: DID,
        sessionId: SID,
        userId: 'user-42'
    },
    {
        t: BASE_TS + 10000,
        v: 1,
        c: 'uxrr:net',
        m: 'PUT /api/user/preferences',
        d: {
            method: 'PUT',
            url: 'https://example.com/api/user/preferences',
            status: 200,
            duration: 210,
            requestHeaders: { 'Content-Type': 'application/json' },
            requestBody: '{"theme":"dark","lang":"en"}'
        },
        appId: AID,
        deviceId: DID,
        sessionId: SID,
        userId: 'user-42'
    },
    {
        t: BASE_TS + 18000,
        v: 1,
        c: 'uxrr:net',
        m: 'GET /api/reports',
        d: {
            method: 'GET',
            url: 'https://example.com/api/reports?page=1',
            status: 404,
            duration: 55,
            responseBody: '{"error":"Not Found"}'
        },
        appId: AID,
        deviceId: DID,
        sessionId: SID,
        userId: 'user-42'
    }
];

// ─── Chat Messages ───────────────────────────────────────────────────
export const chatMessages: IChatMessage[] = [
    {
        message: "Hi Jane, I noticed you're having trouble with the reports page. Can I help?",
        from: 'Agent Sarah',
        timestamp: BASE_TS + 25000
    },
    {
        message: 'Yes! The reports page keeps showing a 404 error when I try to load it.',
        from: 'user',
        timestamp: BASE_TS + 30000
    },
    {
        message: 'I can see the error in your session. Let me check the backend logs.',
        from: 'Agent Sarah',
        timestamp: BASE_TS + 35000
    },
    {
        message: "It looks like the reports API endpoint was recently updated. I'll fix the URL on your end.",
        from: 'Agent Sarah',
        timestamp: BASE_TS + 50000
    },
    {
        message: 'Try refreshing the page now.',
        from: 'Agent Sarah',
        timestamp: BASE_TS + 55000
    },
    {
        message: 'That worked! Thank you so much!',
        from: 'user',
        timestamp: BASE_TS + 65000
    }
];

// ─── Live Chat Messages (for WS-mocked live session) ─────────────────
export const liveChatMessages: { message: string; from: string }[] = [
    {
        message: "Hi Bob, I can see you're on the staging environment. Need any help?",
        from: 'Agent Sarah'
    },
    {
        message: 'Yeah, the checkout flow is broken after the last deploy. Can you take a look?',
        from: 'user'
    },
    {
        message: 'I can see it in the network panel — the /api/cart endpoint is returning 502. Let me check the logs.',
        from: 'Agent Sarah'
    },
    {
        message: "Looks like the cart service pod is restarting. I'll trigger a rollback.",
        from: 'Agent Sarah'
    },
    {
        message: 'OK try refreshing now.',
        from: 'Agent Sarah'
    }
];

// ─── Admin: Apps ─────────────────────────────────────────────────────
export const adminApps: AppResponse[] = [
    {
        id: 'my-app',
        name: 'My Application',
        origins: ['https://myapp.example.com', 'http://localhost:3000'],
        isActive: true,
        createdAt: '2025-01-15T10:00:00Z',
        updatedAt: '2025-06-10T08:30:00Z'
    },
    {
        id: 'other-app',
        name: 'Other Application',
        origins: ['https://other.example.com'],
        isActive: true,
        createdAt: '2025-03-20T14:00:00Z',
        updatedAt: '2025-06-01T12:00:00Z'
    },
    {
        id: 'deprecated-app',
        name: 'Deprecated App',
        origins: ['https://old.example.com'],
        isActive: false,
        createdAt: '2024-11-01T09:00:00Z',
        updatedAt: '2025-05-15T16:45:00Z'
    }
];

// ─── Admin: Users ────────────────────────────────────────────────────
export const adminUsers: UserResponse[] = [
    {
        id: 'user-admin-1',
        email: 'admin@example.com',
        name: 'Admin User',
        isAdmin: true,
        lastLoginAt: '2025-06-15T14:00:00Z',
        createdAt: '2025-01-01T00:00:00Z'
    },
    {
        id: 'user-regular-2',
        email: 'viewer@example.com',
        name: 'Regular Viewer',
        isAdmin: false,
        lastLoginAt: '2025-06-14T09:30:00Z',
        createdAt: '2025-02-10T11:00:00Z'
    },
    {
        id: 'user-regular-3',
        email: 'support@example.com',
        name: 'Support Agent',
        isAdmin: false,
        lastLoginAt: '2025-06-13T16:45:00Z',
        createdAt: '2025-04-05T08:00:00Z'
    }
];

// ─── Admin: API Keys ─────────────────────────────────────────────────
export const adminApiKeys: ApiKeyResponse[] = [
    {
        id: 'key-1',
        name: 'Production Ingest Key',
        keyPrefix: 'uxrr_pk_',
        scope: 'readonly',
        appIds: ['my-app'],
        isActive: true,
        createdAt: '2025-02-01T10:00:00Z',
        updatedAt: '2025-02-01T10:00:00Z'
    },
    {
        id: 'key-2',
        name: 'Support Agent Key',
        keyPrefix: 'uxrr_sk_',
        scope: 'interactive',
        appIds: ['my-app', 'other-app'],
        isActive: true,
        createdAt: '2025-04-10T14:00:00Z',
        updatedAt: '2025-04-10T14:00:00Z'
    },
    {
        id: 'key-3',
        name: 'Old Test Key',
        keyPrefix: 'uxrr_tk_',
        scope: 'readonly',
        appIds: ['deprecated-app'],
        isActive: false,
        createdAt: '2024-12-01T09:00:00Z',
        updatedAt: '2025-05-01T12:00:00Z'
    }
];

// ─── Auth Responses ──────────────────────────────────────────────────
export const authConfig: AuthConfigResponse = {
    oidc: null,
    grafana: null
};

export const meResponse: MeResponse = {
    userId: 'user-admin-1',
    userName: 'Admin User',
    userEmail: 'admin@example.com',
    scope: 'admin',
    isAdmin: true
};
