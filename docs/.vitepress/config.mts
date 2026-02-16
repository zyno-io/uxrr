import { defineConfig } from 'vitepress';

export default defineConfig({
    title: 'uxrr',
    description: 'Self-hosted session recording and replay',
    head: [['link', { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }]],

    themeConfig: {
        siteTitle: 'uxrr',

        nav: [
            { text: 'Guide', link: '/guide/what-is-uxrr' },
            { text: 'Client SDK', link: '/sdk/installation' },
            { text: 'Self-Hosting', link: '/self-hosting/requirements' },
            { text: 'Embed API', link: '/embed/overview' }
        ],

        sidebar: {
            '/guide/': [
                {
                    text: 'Introduction',
                    items: [
                        { text: 'What Is uxrr', link: '/guide/what-is-uxrr' },
                        { text: 'Architecture', link: '/guide/architecture' }
                    ]
                }
            ],
            '/sdk/': [
                {
                    text: 'Client SDK',
                    items: [
                        { text: 'Installation', link: '/sdk/installation' },
                        {
                            text: 'Configuration',
                            link: '/sdk/configuration'
                        },
                        { text: 'Identity', link: '/sdk/identity' },
                        { text: 'Logging', link: '/sdk/logging' },
                        {
                            text: 'Network Tracing',
                            link: '/sdk/network-tracing'
                        },
                        {
                            text: 'Privacy Controls',
                            link: '/sdk/privacy'
                        },
                        {
                            text: 'Live Support',
                            link: '/sdk/live-support'
                        }
                    ]
                }
            ],
            '/self-hosting/': [
                {
                    text: 'Self-Hosting',
                    items: [
                        {
                            text: 'Requirements',
                            link: '/self-hosting/requirements'
                        },
                        {
                            text: 'Deployment',
                            link: '/self-hosting/deployment'
                        },
                        {
                            text: 'Configuration Reference',
                            link: '/self-hosting/configuration'
                        },
                        {
                            text: 'Authentication (OIDC)',
                            link: '/self-hosting/authentication'
                        }
                    ]
                }
            ],
            '/embed/': [
                {
                    text: 'Embed API',
                    items: [{ text: 'Overview', link: '/embed/overview' }]
                }
            ]
        },

        socialLinks: [{ icon: 'github', link: 'https://github.com/zyno-io/uxrr' }],

        footer: {
            message: 'Source-available under the uxrr Source Available License.',
            copyright: 'Copyright &copy; 2026 Signal24 LLC dba Zyno Consulting'
        },

        search: {
            provider: 'local'
        }
    }
});
