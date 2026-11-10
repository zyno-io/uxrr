# Changelog

## Unreleased

- License updated to the uxrr Source Available License, Version 1.1. Self-hosting for internal use remains free
    - The client SDK (`@zyno-io/uxrr-client`) is now licensed under the MIT License, so it can be embedded in your
      websites and applications and delivered to their visitors. This applies to all previously published versions too
    - Recording and supporting the end users of your own websites and applications is expressly internal use
    - Adds contribution terms (inbound license to the Licensor) and permits forking to prepare a contribution
    - You own the copyright in your own modifications, which remain subject to the License
    - Contractors no longer need confidentiality obligations; they must be bound to use your copies and deployments only
      on your behalf. Your affiliates may use uxrr under your license
    - A contractor or service provider may operate your instance, but not one that offers uxrr hosting or management as
      a service to others; that requires a commercial license
    - Termination: 30-day cure period for breaches other than hosting, embedding, distribution, white-labelling,
      circumvention, or willful breach. Licensor notices must be retained on copies
    - Sister companies related only through a common financial investor are not affiliates
    - Embedding uxrr in customer-facing products requires a commercial license (noted in the Embed API docs)
- Contributions now require signing the Contributor License Agreement (`CLA.md`), checked by a CLA bot on GitHub pull
  requests. See `CONTRIBUTING.md`
- Fix the `license` field in `package.json` files to point at `LICENSE.md`
- The client SDK npm package now ships its `LICENSE` file (previously omitted) and a generated `THIRD-PARTY-NOTICES.md`
  with the license texts of the bundled dependencies (rrweb, OpenTelemetry, zone.js) and the third-party code they embed

## v0.1.2

- Fix 500 errors on missing resources: use `findOneOrUndefined` + `HttpNotFoundError`
- Switch from Prettier to oxfmt/oxlint

## v0.1.1

- Initial release
