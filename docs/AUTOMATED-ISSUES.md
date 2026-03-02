# Automated Issue Management

This repository uses AI-powered automation to help triage and fix issues.

## Features

### 1. Issue Assistant (Automatic)

When a new issue is created, Claude automatically:
- Analyzes the issue content
- Categorizes it (bug/feature/question/documentation)
- Assesses severity (critical/high/medium/low)
- Suggests next steps
- Auto-applies relevant labels

**Triggers**: New issues, or when labeled with `needs-triage` or `bug`

### 2. Auto-fix (Manual trigger)

For simple issues, you can trigger an automatic fix attempt:

1. Label the issue with `auto-fix`
2. The workflow will:
   - Analyze the issue with Claude
   - Determine if it can be automatically fixed
   - Generate code changes if applicable
   - Create a PR with the fix
   - Comment on the issue with results

**Good candidates for auto-fix**:
- Documentation typos
- Simple bug fixes
- Missing type definitions
- Code formatting issues

**Not suitable for auto-fix**:
- Complex architectural changes
- Breaking changes
- Issues requiring design decisions

## Setup

### Required Secrets

Add these to your GitHub repository secrets (Settings → Secrets and variables → Actions):

1. **ANTHROPIC_API_KEY**: Your Anthropic API key
   - Get it from: https://console.anthropic.com/settings/keys
   - Recommended: Create a separate key for CI/CD with usage limits

### Optional: Rate Limiting

To avoid excessive API usage, consider:

1. **Limit to specific labels**: Only run on issues labeled `needs-triage` or `auto-fix`
2. **Add approval step**: Require manual approval before running auto-fix
3. **Set usage quotas**: Monitor API usage in Anthropic console

## Usage Examples

### Example 1: New bug report

```
Title: findFirst returns undefined for valid ID
Body: When I call findFirst with a valid thread ID, it returns undefined...
```

**Automated response**:
```
🤖 Automated Analysis

Category: Bug
Severity: High
Suggested next steps:
1. Verify the subjectTemplate configuration
2. Check if the ID format matches the template
3. Review resource resolver logs

This appears to be related to multi-variable template handling.
Would you be able to provide your table schema?
```

**Auto-labels**: `bug`, `priority-high`

### Example 2: Documentation fix

```
Title: Typo in README
Body: Line 42 has "recieve" instead of "receive"
```

**Manual action**: Add `auto-fix` label

**Automated result**:
- Creates PR with fix
- Comments: "✅ A fix has been generated and a PR will be created"

## Monitoring

Check workflow runs:
- https://github.com/undefinedsco/drizzle-solid/actions/workflows/issue-assistant.yml
- https://github.com/undefinedsco/drizzle-solid/actions/workflows/auto-fix.yml

## Cost Estimation

Based on Claude Sonnet 4.6 pricing:
- Issue analysis: ~500 tokens input + 500 tokens output = $0.015 per issue
- Auto-fix attempt: ~2000 tokens input + 2000 tokens output = $0.06 per attempt

Expected monthly cost (assuming 20 issues/month):
- Issue assistant: $0.30/month
- Auto-fix (5 attempts): $0.30/month
- **Total: ~$0.60/month**

## Limitations

- Cannot access private repository data beyond what's in the issue
- Cannot run tests or verify fixes work
- Best for simple, well-defined issues
- Complex issues still require human review

## Future Enhancements

- [ ] Integration with test suite (run tests before creating PR)
- [ ] Multi-turn conversation for clarification
- [ ] Learning from past issues and fixes
- [ ] Integration with project management tools
- [ ] Automatic security vulnerability detection
