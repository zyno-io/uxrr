// Generates THIRD-PARTY-NOTICES.md for the published client bundle.
//
// tsup bundles every dependency into dist/ (noExternal), so the npm package
// redistributes third-party code and must carry its license and NOTICE texts.
// The esbuild metafiles written by the build list exactly which packages were
// bundled; this script reads them, collects each package's license files, and
// then removes the metafiles so they are not published.

import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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

// Packages whose npm tarball omits the license file. Texts are vendored from the
// upstream repository (at the bundled version's tag) into licenses/.
const VENDORED_LICENSES = {
    rrweb: 'rrweb-LICENSE', // github.com/rrweb-io/rrweb, tag rrweb@2.1.7
    '@rrweb/rrweb-plugin-console-record': 'rrweb-LICENSE' // same monorepo, root LICENSE
};

const entries = [...pkgDirs]
    .map(dir => {
        const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
        const texts = readdirSync(dir)
            .filter(f => LICENSE_FILE.test(f))
            .sort()
            .map(f => ({ file: f, text: readFileSync(join(dir, f), 'utf8').trim() }));
        const vendored = VENDORED_LICENSES[pkg.name];
        if (texts.length === 0 && vendored) {
            texts.push({
                file: `LICENSE (from upstream repository)`,
                text: readFileSync(join(pkgRoot, 'licenses', vendored), 'utf8').trim()
            });
        }
        const repo = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
        return { name: pkg.name, version: pkg.version, license: pkg.license ?? 'UNKNOWN', repo, texts };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

const missing = entries.filter(e => e.texts.length === 0);
if (missing.length > 0) {
    console.error('third-party-notices: no license file found for: ' + missing.map(e => `${e.name}@${e.version} (${e.license})`).join(', '));
    process.exit(1);
}

// Nested copies of the same name@version appear once; identical license texts
// (e.g. the Apache-2.0 text shared by every OpenTelemetry package) are printed
// once with the packages that use them.
const unique = [...new Map(entries.map(e => [`${e.name}@${e.version}`, e])).values()];
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
for (const e of unique) out += `- ${e.name}@${e.version} (${e.license})${e.repo ? ` — ${e.repo}` : ''}\n`;
for (const g of groups.values()) {
    out += `\n---\n\nUsed by: ${g.pkgs.map(e => `${e.name}@${e.version}`).join(', ')}\n`;
    for (const t of g.texts) out += `\n### ${t.file}\n\n\`\`\`\n${t.text}\n\`\`\`\n`;
}

writeFileSync(outFile, out);
console.log(`third-party-notices: wrote ${unique.length} packages to ${outFile}`);
