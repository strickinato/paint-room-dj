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
    npx electron-builder --mac --arm64 --x64

clean:
  rm -rf dist

# Build, create GitHub release, deploy landing page
release: clean build
    #!/usr/bin/env bash
    set -euo pipefail
    tag="v{{version}}"
    arm64_dmg=$(ls dist/build/*-arm64.dmg 2>/dev/null | head -1)
    x64_dmg=$(ls dist/build/*-x64.dmg 2>/dev/null || ls dist/build/*[!4].dmg 2>/dev/null | grep -v arm64 | head -1)
    if [ -z "$arm64_dmg" ] || [ -z "$x64_dmg" ]; then
        echo "Expected arm64 and x64 DMGs in dist/build/"
        ls dist/build/*.dmg 2>/dev/null
    
    fi
    # Stable filenames so download links don't change between versions
    cp "$arm64_dmg" dist/build/paint-room-dj-arm64.dmg
    cp "$x64_dmg" dist/build/paint-room-dj-x64.dmg
    echo "Creating GitHub release $tag..."
    git tag -f "$tag"
    git push origin "$tag" --force
    gh release delete "$tag" --yes 2>/dev/null || true
    gh release create "$tag" \
        dist/build/paint-room-dj-arm64.dmg \
        dist/build/paint-room-dj-x64.dmg \
        --title "$tag" --generate-notes
    echo "Deploying landing page..."
    npx vercel deploy --prod
