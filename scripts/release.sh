#!/usr/bin/env bash
set -euo pipefail

if [ -z "${1:-}" ]; then
    echo "Usage: $0 <version>"
    echo "Example: $0 1.0.0"
    exit 1
fi

# Strip leading 'v' if provided
VERSION="${1#v}"
TAG="v$VERSION"

# Ensure we're on main and clean
BRANCH=$(git branch --show-current)
if [ "$BRANCH" != "main" ]; then
    echo "Error: must be on main branch (currently on $BRANCH)"
    exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
    echo "Error: working tree is not clean"
    exit 1
fi

# Check tag doesn't already exist
if git rev-parse "$TAG" >/dev/null 2>&1; then
    echo "Error: tag $TAG already exists"
    exit 1
fi

# Check CHANGELOG.md has an entry for this version
if ! grep -q "^## $TAG$" CHANGELOG.md; then
    echo "Error: CHANGELOG.md has no entry for $TAG"
    echo "Add a '## $TAG' section to CHANGELOG.md before releasing."
    exit 1
fi

echo "Releasing $TAG..."

# Update all package.json files
for pkg in package.json packages/*/package.json; do
    node -e "
        const fs = require('fs');
        const pkg = JSON.parse(fs.readFileSync('$pkg', 'utf8'));
        pkg.version = '$VERSION';
        fs.writeFileSync('$pkg', JSON.stringify(pkg, null, 4) + '\n');
    "
    echo "  Updated $pkg"
done

# Commit, tag, push
git add package.json packages/*/package.json
git commit -m "$TAG"
git tag "$TAG"
git push origin main "$TAG"

echo "Released $TAG"
