# Changelog

## 0.1.0 (2026-04-07)

Initial release.

### Features

- **20 commands** across attestations, artifacts, environments, deployments, compliance, and more
- **Attestation parsers**: JUnit XML, Snyk SARIF/JSON, SonarQube, Jira ticket verification, PR/MR verification, custom types
- **Artifact tracking**: SHA-256 fingerprinting for files, directories, and Docker images
- **Environment snapshots**: Docker, Kubernetes, ECS, Lambda, S3, Azure, and filesystem
- **Deployment gates**: Score-based deployment gating with approval workflows
- **Delivery flows and trails**: Model multi-stage delivery pipelines with compliance evaluation
- **Policy management**: Create, attach, and enforce compliance policies
- **Compliance assertions**: Assert artifact, snapshot, PR, and approval compliance
- **SBOM submission**: SPDX and CycloneDX support
- **CI auto-detection**: GitHub Actions, GitLab CI, Jenkins, CircleCI, Azure Pipelines, Bitbucket Pipelines, TeamCity, Travis CI
- **Config file support**: `.mergewhy.json` for project-level defaults
- **Shell completions**: bash, zsh, fish, powershell
