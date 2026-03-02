# Release Process

This document describes the automated release process for drizzle-solid.

## Prerequisites

1. **NPM Token**: Add `NPM_TOKEN` to GitHub repository secrets
   - Go to https://www.npmjs.com/settings/YOUR_USERNAME/tokens
   - Create a new "Automation" token
   - Add it to GitHub: Settings → Secrets and variables → Actions → New repository secret
   - Name: `NPM_TOKEN`

2. **Permissions**: Ensure you have push access to the repository and npm publish rights

## Automated Release (Recommended)

### Using the release script

```bash
# Patch release (0.2.8 → 0.2.9)
./scripts/release.sh patch

# Minor release (0.2.8 → 0.3.0)
./scripts/release.sh minor

# Major release (0.2.8 → 1.0.0)
./scripts/release.sh major
```

The script will:
1. ✓ Check working directory is clean
2. ✓ Pull latest changes
3. ✓ Run quality checks (lint + test)
4. ✓ Update package.json version
5. ✓ Commit version bump
6. ✓ Create and push git tag
7. ✓ Trigger GitHub Actions to publish to npm

### Manual release

If you prefer to do it manually:

```bash
# 1. Update version in package.json
npm version patch  # or minor, or major

# 2. Commit the change
git add package.json
git commit -m "chore: bump version to X.Y.Z"

# 3. Create and push tag
git tag -a vX.Y.Z -m "Release vX.Y.Z"
git push origin main
git push origin vX.Y.Z
```

## What happens after pushing a tag?

1. **GitHub Actions** detects the new tag (format: `v*.*.*`)
2. **CI checks** run (lint, build, test)
3. **Version verification** ensures package.json matches the tag
4. **npm publish** publishes the package to npm registry
5. **GitHub Release** is created automatically with release notes

## Monitoring

- Check workflow status: https://github.com/undefinedsco/drizzle-solid/actions
- View releases: https://github.com/undefinedsco/drizzle-solid/releases
- npm package: https://www.npmjs.com/package/@undefineds.co/drizzle-solid

## Troubleshooting

### Release failed

If the GitHub Action fails:

1. Check the workflow logs for errors
2. Fix the issue locally
3. Delete the failed tag: `git tag -d vX.Y.Z && git push origin :refs/tags/vX.Y.Z`
4. Try again with the same version

### Version mismatch

If package.json version doesn't match the tag:

```bash
# Update package.json to match the tag
npm version X.Y.Z --no-git-tag-version
git add package.json
git commit --amend --no-edit
git push origin main --force-with-lease
```

### npm publish failed

If npm publish fails but the tag was created:

1. Check npm token is valid and has publish permissions
2. Verify package name is available on npm
3. Manually publish: `yarn build && yarn publish`

## CI/CD Workflows

### CI (`ci.yml`)
- Triggers on: push to main/develop, pull requests
- Runs on: Node.js 18, 20, 22
- Steps: lint → build → test → coverage

### Release (`release.yml`)
- Triggers on: tag push (v*.*.*)
- Runs on: Node.js 20
- Steps: lint → build → test → verify version → publish npm → create GitHub release

## Best Practices

1. **Always release from main branch**
2. **Run tests locally before releasing**: `yarn quality`
3. **Use semantic versioning**:
   - Patch (0.2.8 → 0.2.9): Bug fixes
   - Minor (0.2.8 → 0.3.0): New features (backward compatible)
   - Major (0.2.8 → 1.0.0): Breaking changes
4. **Write meaningful commit messages** for the version bump
5. **Check the GitHub Actions logs** after pushing a tag
