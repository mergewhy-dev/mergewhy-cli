# @mergewhy/cli

Change evidence for every merge. Record attestations, artifacts, deployments, and compliance data from any CI/CD pipeline.

MergeWhy captures the "why" behind every code change at merge time. When auditors ask "why was this change made?" -- MergeWhy has the answer.

## Installation

```bash
# Install globally
npm install -g @mergewhy/cli

# Or run directly with npx
npx @mergewhy/cli --help
```

## Quick Start

1. Generate an API key at [mergewhy.com/dashboard/settings](https://mergewhy.com/dashboard/settings)
2. Set the environment variable:
   ```bash
   export MERGEWHY_API_KEY=mw_...
   ```
3. Record your first attestation:
   ```bash
   mergewhy attest --type TEST_RESULTS --name "Unit Tests" --passed
   ```

## CI Auto-Detection

The CLI automatically detects CI environments and populates `--repo`, `--commit`, `--branch`, and `--pr`:

- GitHub Actions
- GitLab CI
- Jenkins
- CircleCI
- Azure Pipelines
- Bitbucket Pipelines
- TeamCity
- Travis CI

## Commands

### Attestations

```bash
# Generic attestation
mergewhy attest --type TEST_RESULTS --name "Unit Tests" --passed

# Parse JUnit XML test results
mergewhy attest junit --results-dir ./test-reports --name "Unit Tests"

# Parse Snyk SARIF/JSON security scan
mergewhy attest snyk --scan-results snyk-report.json --name "Snyk"

# Fetch SonarQube quality gate status
mergewhy attest sonar --sonar-url https://sonar.example.com --project-key my-app

# Verify Jira ticket references in commits
mergewhy attest jira --jira-url https://myorg.atlassian.net --jira-token $JIRA_TOKEN

# Verify PR/MR exists for this commit
mergewhy attest pullrequest github --github-token $GITHUB_TOKEN

# Record a custom attestation
mergewhy attest custom --type "LOAD_TEST" --data '{"p99": 42}'

# Submit an SBOM (SPDX or CycloneDX)
mergewhy sbom --file sbom.cdx.json
```

### Artifacts

```bash
# Record a build artifact with SHA-256 fingerprint
mergewhy artifact --name "api-server" --sha256 a1b2c3... --type docker --tag v1.2.3

# Calculate SHA-256 fingerprint
mergewhy fingerprint file ./build/app.jar
mergewhy fingerprint dir ./dist
mergewhy fingerprint docker myimage:latest

# Allowlist an artifact for environment compliance
mergewhy allow --artifact-sha256 a1b2... --environment production --reason "Vendor image"
```

### Environments

```bash
# Capture runtime snapshots
mergewhy snapshot docker --environment production
mergewhy snapshot kubernetes --environment staging --namespace default
mergewhy snapshot ecs --environment production --cluster my-cluster
mergewhy snapshot s3 --bucket my-artifacts --environment production
mergewhy snapshot path --path /opt/myapp --exclude "*.log"

# Manage environments
mergewhy environment create --name production --type k8s
mergewhy environment list
mergewhy environment log --name production
mergewhy environment diff --name production --from snap_1 --to snap_2
```

### Deployments and Gates

```bash
# Record a deployment event
mergewhy deploy --environment production --artifact-sha256 a1b2c3...

# Check deployment gate (exit 0 = pass, exit 1 = fail)
mergewhy gate --environment production --min-score 80

# Approval workflow
mergewhy approve request --artifact-sha256 a1b2c3... --environment production
mergewhy approve check --artifact-sha256 a1b2c3... --environment production
mergewhy approve report --environment production
```

### Flows and Trails

```bash
# Manage delivery flows
mergewhy flow create --name "Payment Service" --template flow.yaml
mergewhy flow list
mergewhy flow get --name "Payment Service"

# Manage delivery trails
mergewhy trail create --name "Release v2.1"
mergewhy trail attest --trail-id abc123 --type TEST_RESULTS --name "E2E" --passed
mergewhy trail complete --trail-id abc123
```

### Pipelines

```bash
# Record a CI/CD pipeline run
mergewhy pipeline --name "Build & Test" --status passed --duration 142
```

### Compliance

```bash
# Manage policies
mergewhy policy create --name "prod-gate" --file policy.yaml
mergewhy policy attach --name "prod-gate" --environment production
mergewhy policy detach --name "prod-gate" --environment production
mergewhy policy list

# Assert compliance
mergewhy assert artifact --sha256 a1b2c3... --environment production
mergewhy assert snapshot --environment production
mergewhy assert pullrequest github --repository owner/repo --commit abc123
mergewhy assert approval --sha256 a1b2c3... --environment production

# Evaluate trail compliance
mergewhy evaluate trail --flow "Payment Service"

# Pre-announce a deployment
mergewhy expect --environment production --artifact-sha256 a1b2c3...
```

### Status and Search

```bash
# Show compliance status for a repo or commit
mergewhy status --repo owner/repo
mergewhy status --commit abc123

# Search by artifact fingerprint or commit SHA
mergewhy search --fingerprint a1b2c3d4...
mergewhy search --commit abc123
```

### Utilities

```bash
# Tag resources with metadata labels
mergewhy tag --resource-type artifact --resource-id abc123 --tags "release:v2.1,team:payments"

# Generate shell completions
mergewhy completion bash >> ~/.bashrc
mergewhy completion zsh >> ~/.zshrc
mergewhy completion fish > ~/.config/fish/completions/mergewhy.fish
```

## CI Integration Examples

### GitHub Actions

```yaml
- name: Record test attestation
  run: npx @mergewhy/cli attest junit --results-dir ./test-reports --name "Unit Tests"
  env:
    MERGEWHY_API_KEY: ${{ secrets.MERGEWHY_API_KEY }}

- name: Check deployment gate
  run: npx @mergewhy/cli gate --environment production --min-score 80
  env:
    MERGEWHY_API_KEY: ${{ secrets.MERGEWHY_API_KEY }}
```

### GitLab CI

```yaml
record-evidence:
  script:
    - npx @mergewhy/cli attest junit --results-dir ./test-reports --name "Unit Tests"
    - npx @mergewhy/cli gate --environment production --min-score 80
  variables:
    MERGEWHY_API_KEY: $MERGEWHY_API_KEY
```

### Jenkins

```groovy
pipeline {
  environment {
    MERGEWHY_API_KEY = credentials('mergewhy-api-key')
  }
  stages {
    stage('Evidence') {
      steps {
        sh 'npx @mergewhy/cli attest junit --results-dir ./test-reports --name "Unit Tests"'
        sh 'npx @mergewhy/cli gate --environment production --min-score 80'
      }
    }
  }
}
```

## Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `MERGEWHY_API_KEY` | Yes | API key from [mergewhy.com/dashboard/settings](https://mergewhy.com/dashboard/settings) |
| `MERGEWHY_API_URL` | No | API base URL (default: `https://mergewhy.com`) |

### Config File

Create a `.mergewhy.json` in your project root (or any parent directory):

```json
{
  "apiUrl": "https://mergewhy.com",
  "repo": "myorg/myrepo",
  "environment": "production",
  "minScore": 80,
  "output": "json",
  "framework": "soc2"
}
```

Environment variables always take precedence over config file values.

## Supported Frameworks

SOC 2, SOX ITGC, SOX 404, CMMC (L1/L2/L3), FedRAMP, NIST 800-53, ISO 27001, HIPAA, DORA, GDPR, PCI-DSS.

## Documentation

Full documentation: [mergewhy.com/docs](https://mergewhy.com/docs)

## License

MIT
