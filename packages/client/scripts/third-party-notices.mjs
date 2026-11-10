// Generates THIRD-PARTY-NOTICES.md for the published client bundle.
//
// tsup bundles every dependency into dist/ (noExternal), so the npm package
// redistributes third-party code and must carry its license and NOTICE texts.
// The esbuild metafiles written by the build list exactly which packages were
// bundled; this script reads them, collects each package's license files, and
// then removes the metafiles so they are not published.

import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = join(pkgRoot, 'dist');
const outFile = join(pkgRoot, 'THIRD-PARTY-NOTICES.md');

const metafiles = readdirSync(distDir).filter(f => /^metafile-.*\.json$/.test(f));
if (metafiles.length === 0) {
    console.error('third-party-notices: no esbuild metafiles in dist/ (is `metafile: true` set in tsup.config.ts?)');
    process.exit(1);
}

// Map each bundled input file to the root directory of the package it came from.
const pkgDirs = new Set();
for (const file of metafiles) {
    const meta = JSON.parse(readFileSync(join(distDir, file), 'utf8'));
    for (const input of Object.keys(meta.inputs)) {
        const idx = input.lastIndexOf('node_modules/');
        if (idx === -1) continue;
        const rest = input.slice(idx + 'node_modules/'.length).split('/');
        const nameParts = rest[0].startsWith('@') ? rest.slice(0, 2) : rest.slice(0, 1);
        pkgDirs.add(resolve(pkgRoot, input.slice(0, idx + 'node_modules/'.length) + nameParts.join('/')));
    }
    rmSync(join(distDir, file));
}

const LICENSE_FILE = /^(licen[sc]e|copying|notice)(\.(md|txt))?$/i;
const readText = path => readFileSync(path, 'utf8').trim();
const vendoredText = file => readText(join(pkgRoot, 'licenses', file));

// Packages whose npm tarball omits the license file. Texts are vendored from the
// upstream repository (at the bundled version's tag) into licenses/.
const VENDORED_LICENSES = {
    rrweb: 'rrweb-LICENSE', // github.com/rrweb-io/rrweb, tag rrweb@2.1.7
    '@rrweb/rrweb-plugin-console-record': 'rrweb-LICENSE' // same monorepo, root LICENSE
};

// Third-party code that a bundled package had already bundled or copied into its
// own dist/ before we bundle it, so it never appears as a separate input. Texts
// are vendored into licenses/. Review this list when upgrading these packages.
const EMBEDDED = {
    rrweb: [
        { name: 'postcss', license: 'MIT', file: 'postcss-LICENSE', repo: 'https://github.com/postcss/postcss' },
        { name: 'nanoid', license: 'MIT', file: 'nanoid-LICENSE', repo: 'https://github.com/ai/nanoid' },
        { name: 'picocolors', license: 'ISC', file: 'picocolors-LICENSE', repo: 'https://github.com/alexeyraspopov/picocolors' },
        { name: 'mitt', license: 'MIT', file: 'mitt-LICENSE', repo: 'https://github.com/developit/mitt' },
        { name: 'base64-arraybuffer', license: 'MIT', file: 'base64-arraybuffer-LICENSE', repo: 'https://github.com/niklasvh/base64-arraybuffer' },
        { name: '@xstate/fsm', license: 'MIT', file: 'xstate-fsm-LICENSE', repo: 'https://github.com/statelyai/xstate' }
    ],
    '@rrweb/rrweb-plugin-console-record': [
        { name: 'stackframe', license: 'MIT', file: 'stackframe-LICENSE', repo: 'https://github.com/stacktracejs/stackframe' },
        { name: 'error-stack-parser', license: 'MIT', file: 'error-stack-parser-LICENSE', repo: 'https://github.com/stacktracejs/error-stack-parser' }
    ],
    '@opentelemetry/core': [
        // build/esm/utils/lodash.merge.js is "based on lodash"
        { name: 'lodash', license: 'MIT', file: 'lodash-LICENSE', repo: 'https://github.com/lodash/lodash' }
    ]
};

// Names that show up in the bundle's source maps (via the bundled packages' own
// source maps) and are covered by another entry: rrweb's monorepo packages.
const COVERED_BY_RRWEB = new Set(['rrdom', 'rrweb-snapshot', 'types', 'utils', '@rrweb/types', '@rrweb/utils']);

const entries = [];
for (const dir of pkgDirs) {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    const texts = readdirSync(dir)
        .filter(f => LICENSE_FILE.test(f))
        .sort()
        .map(f => ({ file: f, text: readText(join(dir, f)) }));
    if (texts.length === 0 && VENDORED_LICENSES[pkg.name]) {
        texts.push({ file: 'LICENSE (from upstream repository)', text: vendoredText(VENDORED_LICENSES[pkg.name]) });
    }
    const repo = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
    entries.push({ name: pkg.name, version: pkg.version, license: pkg.license ?? 'UNKNOWN', repo, texts });

    const via = `${pkg.name}@${pkg.version}`;
    // Packages that ship their vendored dependencies' licenses under LICENSES/<name>/.
    const licensesDir = join(dir, 'LICENSES');
    if (existsSync(licensesDir)) {
        for (const name of readdirSync(licensesDir).sort()) {
            const sub = join(licensesDir, name);
            if (!statSync(sub).isDirectory()) continue;
            const subTexts = readdirSync(sub)
                .filter(f => LICENSE_FILE.test(f))
                .sort()
                .map(f => ({ file: `LICENSES/${name}/${f}`, text: readText(join(sub, f)) }));
            entries.push({ name, version: `embedded in ${via}`, license: 'see text', repo: undefined, texts: subTexts });
        }
    }
    for (const e of EMBEDDED[pkg.name] ?? []) {
        entries.push({
            name: e.name,
            version: `embedded in ${via}`,
            license: e.license,
            repo: e.repo,
            texts: [{ file: 'LICENSE (from upstream repository)', text: vendoredText(e.file) }]
        });
    }
}
entries.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));

const missing = entries.filter(e => e.texts.length === 0);
if (missing.length > 0) {
    console.error('third-party-notices: no license file found for: ' + missing.map(e => `${e.name}@${e.version} (${e.license})`).join(', '));
    process.exit(1);
}

// Guard against new pre-bundled code: every package named in the output source
// maps (which chain through the bundled packages' own source maps) must be listed.
const listed = new Set([...entries.map(e => e.name), ...COVERED_BY_RRWEB]);
const unlisted = new Set();
for (const file of readdirSync(distDir).filter(f => f.endsWith('.map'))) {
    for (const source of JSON.parse(readFileSync(join(distDir, file), 'utf8')).sources) {
        const idx = source.lastIndexOf('node_modules/');
        if (idx === -1) continue;
        const rest = source.slice(idx + 'node_modules/'.length).split('/');
        const name = (rest[0].startsWith('@') ? rest.slice(0, 2) : rest.slice(0, 1)).join('/');
        if (!listed.has(name)) unlisted.add(name);
    }
}
if (unlisted.size > 0) {
    console.error(
        `third-party-notices: source maps reference packages with no notice: ${[...unlisted].join(', ')}. ` +
            'Add them to EMBEDDED (with a vendored license) or COVERED_BY_RRWEB in scripts/third-party-notices.mjs.'
    );
    process.exit(1);
}

// Nested copies of the same name@version appear once; identical license texts
// (e.g. the Apache-2.0 text shared by every OpenTelemetry package) are printed
// once with the packages that use them.
const label = e => (e.version.startsWith('embedded in ') ? `${e.name} (${e.version})` : `${e.name}@${e.version}`);
const unique = [...new Map(entries.map(e => [label(e), e])).values()];
const groups = new Map();
for (const e of unique) {
    const key = e.texts.map(t => t.text).join('\n\n');
    if (!groups.has(key)) groups.set(key, { texts: e.texts, pkgs: [] });
    groups.get(key).pkgs.push(e);
}

let out = `# Third-Party Notices

The \`@zyno-io/uxrr-client\` bundle in \`dist/\` includes the following third-party
software. Each component is licensed under its own terms, reproduced below.
The uxrr client itself is licensed under the MIT License (see \`LICENSE\`).

`;
for (const e of unique) out += `- ${label(e)} (${e.license})${e.repo ? ` — ${e.repo}` : ''}\n`;
for (const g of groups.values()) {
    out += `\n---\n\nUsed by: ${g.pkgs.map(label).join(', ')}\n`;
    for (const t of g.texts) out += `\n### ${t.file}\n\n\`\`\`\n${t.text}\n\`\`\`\n`;
}

writeFileSync(outFile, out);
console.log(`third-party-notices: wrote ${unique.length} packages to ${outFile}`);
