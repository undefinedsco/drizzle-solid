#!/bin/bash

# Release script for drizzle-solid
# Usage: ./scripts/release.sh [patch|minor|major]

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if version type is provided
if [ -z "$1" ]; then
  echo -e "${RED}Error: Version type required (patch|minor|major)${NC}"
  echo "Usage: ./scripts/release.sh [patch|minor|major]"
  exit 1
fi

VERSION_TYPE=$1

# Validate version type
if [[ ! "$VERSION_TYPE" =~ ^(patch|minor|major)$ ]]; then
  echo -e "${RED}Error: Invalid version type. Must be patch, minor, or major${NC}"
  exit 1
fi

# Check if working directory is clean (ignore untracked files)
if [[ -n $(git status -s --untracked-files=no) ]]; then
  echo -e "${RED}Error: Working directory has uncommitted changes. Commit or stash changes first.${NC}"
  git status -s --untracked-files=no
  exit 1
fi

# Check if on main branch
CURRENT_BRANCH=$(git branch --show-current)
if [ "$CURRENT_BRANCH" != "main" ]; then
  echo -e "${YELLOW}Warning: Not on main branch (current: $CURRENT_BRANCH)${NC}"
  read -p "Continue anyway? (y/N) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    exit 1
  fi
fi

# Pull latest changes
echo -e "${GREEN}Pulling latest changes...${NC}"
git pull origin $CURRENT_BRANCH

# Run quality checks (unit tests only for release)
echo -e "${GREEN}Running quality checks (lint + build + unit tests)...${NC}"
yarn build && yarn lint && SOLID_OIDC_ISSUER=http://localhost:3000 npx vitest --run tests/unit/

# Get current version
CURRENT_VERSION=$(node -p "require('./package.json').version")
echo -e "${GREEN}Current version: $CURRENT_VERSION${NC}"

# Calculate new version
case $VERSION_TYPE in
  patch)
    NEW_VERSION=$(echo $CURRENT_VERSION | awk -F. '{$NF = $NF + 1;} 1' | sed 's/ /./g')
    ;;
  minor)
    NEW_VERSION=$(echo $CURRENT_VERSION | awk -F. '{$(NF-1) = $(NF-1) + 1; $NF = 0;} 1' | sed 's/ /./g')
    ;;
  major)
    NEW_VERSION=$(echo $CURRENT_VERSION | awk -F. '{$1 = $1 + 1; $2 = 0; $3 = 0;} 1' | sed 's/ /./g')
    ;;
esac

echo -e "${GREEN}New version: $NEW_VERSION${NC}"

# Confirm release
read -p "Release version $NEW_VERSION? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo -e "${YELLOW}Release cancelled${NC}"
  exit 0
fi

# Update package.json version
echo -e "${GREEN}Updating package.json...${NC}"
npm version $NEW_VERSION --no-git-tag-version

# Commit version bump
echo -e "${GREEN}Committing version bump...${NC}"
git add package.json
git commit -m "chore: bump version to $NEW_VERSION"

# Create and push tag
echo -e "${GREEN}Creating tag v$NEW_VERSION...${NC}"
git tag -a "v$NEW_VERSION" -m "Release v$NEW_VERSION"

echo -e "${GREEN}Pushing changes and tag...${NC}"
git push origin $CURRENT_BRANCH
git push origin "v$NEW_VERSION"

echo -e "${GREEN}✓ Release v$NEW_VERSION initiated!${NC}"
echo -e "${GREEN}GitHub Actions will automatically publish to npm.${NC}"
echo -e "${GREEN}Check progress at: https://github.com/undefinedsco/drizzle-solid/actions${NC}"
