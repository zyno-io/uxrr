---
layout: home

hero:
    name: uxrr
    text: User eXperience Realtime & Rewind
    tagline: Self-hosted session recording, console logs, network traces, and live user interaction — all on your own infrastructure. (SaaS version coming soon.)
    image:
        src: /screenshots/session-detail-console.png
        alt: uxrr session replay with console logs
    actions:
        - theme: brand
          text: Get Started
          link: /guide/what-is-uxrr
        - theme: alt
          text: Self-Hosting Guide
          link: /self-hosting/requirements

features:
    - title: Session Recording
      details: Pixel-perfect session replay powered by rrweb. See exactly what your users see.
    - title: Console & Network
      details: Capture console logs and HTTP request traces alongside session playback.
    - title: Live Sessions
      details: Watch active users in real time. Share your cursor, annotate their screen, and chat.
    - title: Embeddable
      details: Embed session lists and replay into your own dashboards via iframe or REST API.
    - title: Self-Hosted
      details: Runs entirely on your infrastructure. Your data never has to leave your network.
    - title: Scalable
      details: Built on S3 for event storage, the Grafana LGTM stack for logs and traces, and OpenTelemetry for trace ingestion. Scale each layer independently.
    - title: Privacy Controls
      details: Mask inputs, block elements, and control exactly what gets recorded.
---
