# paint-room-dj

version := `node -p "require('./package.json').version"`

default:
    @just --list

# Run the Electron app and web landing page
[parallel]
dev: dev-app dev-web

# Run the Electron app
dev-app:
    npx electron .

# Serve the landing page locally
dev-web:
    npx serve web

# Build distributable .dmg
build:
    npx electron-builder --mac

# Build, create GitHub release, deploy landing page
release: build
    #!/usr/bin/env bash
    set -euo pipefail
    tag="v{{version}}"
    dmg=$(ls dist/build/*.dmg 2>/dev/null | head -1)
    if [ -z "$dmg" ]; then
        echo "No DMG found in dist/build/"
        exit 1
    fi
    # Upload with a stable filename so the download link doesn't change between versions
    cp "$dmg" dist/build/paint-room-dj.dmg
    echo "Creating GitHub release $tag..."
    gh release create "$tag" dist/build/paint-room-dj.dmg --title "$tag" --generate-notes
    echo "Deploying landing page..."
    npx vercel deploy --prod
