/**
 * MergeWhy CLI — Change evidence for every merge
 *
 * The most comprehensive change evidence CLI in the industry.
 * 20 commands across attestations, artifacts, environments, compliance, and more.
 */

import { applyConfigDefaults } from "./config.js";

const VERSION = "1.2.0";

async function main(): Promise<void> {
  // Load .mergewhy.json defaults before processing commands
  applyConfigDefaults();

  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === "--help" || command === "-h") {
    printHelp();
    process.exit(0);
  }

  if (command === "--version" || command === "-v") {
    console.log(`mergewhy/${VERSION}`);
    process.exit(0);
  }

  const commandArgs = args.slice(1);

  switch (command) {
    // ── Attestations ──
    case "attest": {
      // Check for specialized attest subcommands
      const sub = commandArgs[0];
      if (sub === "junit") {
        const { attestJunitCommand } = await import("./commands/attest-junit.js");
        await attestJunitCommand(commandArgs.slice(1));
      } else if (sub === "snyk") {
        const { attestSnykCommand } = await import("./commands/attest-snyk.js");
        await attestSnykCommand(commandArgs.slice(1));
      } else if (sub === "sonar") {
        const { attestSonarCommand } = await import("./commands/attest-sonar.js");
        await attestSonarCommand(commandArgs.slice(1));
      } else if (sub === "jira") {
        const { attestJiraCommand } = await import("./commands/attest-jira.js");
        await attestJiraCommand(commandArgs.slice(1));
      } else if (sub === "pullrequest" || sub === "pr") {
        const { attestPullrequestCommand } = await import("./commands/attest-pullrequest.js");
        await attestPullrequestCommand(commandArgs.slice(1));
      } else if (sub === "custom") {
        const { attestCustomCommand } = await import("./commands/attest-custom.js");
        await attestCustomCommand(commandArgs.slice(1));
      } else if (sub === "servicenow" || sub === "snow") {
        const { attestServicenowCommand } = await import("./commands/attest-servicenow.js");
        await attestServicenowCommand(commandArgs.slice(1));
      } else if (sub === "sigstore") {
        const { attestSigstoreCommand } = await import("./commands/attest-sigstore.js");
        await attestSigstoreCommand(commandArgs.slice(1));
      } else if (sub === "test") {
        const { attestTestCommand } = await import("./commands/attest-test.js");
        await attestTestCommand(commandArgs.slice(1));
      } else if (sub === "security" || sub === "sec") {
        const { attestSecurityCommand } = await import("./commands/attest-security.js");
        await attestSecurityCommand(commandArgs.slice(1));
      } else {
        const { attestCommand } = await import("./commands/attest.js");
        await attestCommand(commandArgs);
      }
      break;
    }

    // ── Artifacts ──
    case "artifact": {
      const { artifactCommand } = await import("./commands/artifact.js");
      await artifactCommand(commandArgs);
      break;
    }
    case "fingerprint": {
      const { fingerprintCommand } = await import("./commands/fingerprint.js");
      await fingerprintCommand(commandArgs);
      break;
    }
    case "allow": {
      const { allowCommand } = await import("./commands/allow.js");
      await allowCommand(commandArgs);
      break;
    }

    // ── Environments ──
    case "snapshot": {
      const { snapshotCommand } = await import("./commands/snapshot.js");
      await snapshotCommand(commandArgs);
      break;
    }
    case "environment": case "env": {
      const { environmentCommand } = await import("./commands/environment.js");
      await environmentCommand(commandArgs);
      break;
    }

    // ── Deployments & Gates ──
    case "deploy": {
      const { deployCommand } = await import("./commands/deploy.js");
      await deployCommand(commandArgs);
      break;
    }
    case "gate": {
      const { gateCommand } = await import("./commands/gate.js");
      await gateCommand(commandArgs);
      break;
    }
    case "approve": {
      const { approveCommand } = await import("./commands/approve.js");
      await approveCommand(commandArgs);
      break;
    }

    // ── Pipelines ──
    case "pipeline": {
      const { pipelineCommand } = await import("./commands/pipeline.js");
      await pipelineCommand(commandArgs);
      break;
    }

    // ── Flows & Trails ──
    case "flow": {
      const { flowCommand } = await import("./commands/flow.js");
      await flowCommand(commandArgs);
      break;
    }
    case "trail": {
      const { trailCommand } = await import("./commands/trail.js");
      await trailCommand(commandArgs);
      break;
    }

    // ── Compliance & Policies ──
    case "policy": {
      const { policyCommand } = await import("./commands/policy.js");
      await policyCommand(commandArgs);
      break;
    }
    case "sbom": {
      const { sbomCommand } = await import("./commands/sbom.js");
      await sbomCommand(commandArgs);
      break;
    }

    // ── Status ──
    case "status": {
      const { statusCommand } = await import("./commands/status.js");
      await statusCommand(commandArgs);
      break;
    }

    // ── Search & Discovery ──
    case "search": {
      const { searchCommand } = await import("./commands/search.js");
      await searchCommand(commandArgs);
      break;
    }
    case "ask": {
      const { askCommand } = await import("./commands/ask.js");
      await askCommand(commandArgs);
      break;
    }

    // ── Drift Detection ──
    case "drift": {
      const { driftCommand } = await import("./commands/drift.js");
      await driftCommand(commandArgs);
      break;
    }

    // ── Resource Get & List ──
    case "get": {
      const { getCommand } = await import("./commands/get.js");
      await getCommand(commandArgs);
      break;
    }
    case "list": {
      const { listCommand } = await import("./commands/list.js");
      await listCommand(commandArgs);
      break;
    }

    // ── Attestation Types ──
    case "attestation-type": {
      const { attestationTypeCommand } = await import("./commands/attestation-type.js");
      await attestationTypeCommand(commandArgs);
      break;
    }

    // ── Archive & Rename ──
    case "archive": {
      const { archiveCommand } = await import("./commands/archive.js");
      await archiveCommand(commandArgs);
      break;
    }
    case "rename": {
      const { renameCommand } = await import("./commands/rename.js");
      await renameCommand(commandArgs);
      break;
    }

    // ── Assertions ──
    case "assert": {
      const { assertCommand } = await import("./commands/assert.js");
      await assertCommand(commandArgs);
      break;
    }

    // ── Pre-announce Deployments ──
    case "expect": {
      const { expectCommand } = await import("./commands/expect.js");
      await expectCommand(commandArgs);
      break;
    }

    // ── Evaluate Compliance ──
    case "evaluate": {
      const { evaluateCommand } = await import("./commands/evaluate.js");
      await evaluateCommand(commandArgs);
      break;
    }

    // ── Tag Resources ──
    case "tag": {
      const { tagCommand } = await import("./commands/tag.js");
      await tagCommand(commandArgs);
      break;
    }

    // ── Shell Completion ──
    case "completion": {
      const { completionCommand } = await import("./commands/completion.js");
      await completionCommand(commandArgs);
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      console.error('Run "mergewhy --help" for usage.');
      process.exit(1);
  }
}

function printHelp(): void {
  console.log(`
mergewhy/${VERSION} — Change evidence for every merge

USAGE
  mergewhy <command> [options]

ATTESTATIONS
  attest              Record an attestation (generic: --type, --name, --passed/--failed)
  attest junit        Parse JUnit XML test results (--results-dir)
  attest snyk         Parse Snyk SARIF/JSON security scan (--scan-results)
  attest sonar        Fetch SonarQube quality gate status (--sonar-url, --project-key)
  attest jira         Verify Jira ticket references in commits (--jira-url, --jira-token)
  attest pullrequest  Verify PR/MR exists (github|gitlab|bitbucket|azure)
  attest servicenow  Verify ServiceNow change requests (--instance, --token)
  attest custom       Record a custom-typed attestation (--type, --data)
  attest sigstore     Verify Sigstore/cosign signatures and record attestation
  attest test         Auto-detect test results (JUnit XML) or manual --passed/--failed
  attest security     Auto-detect security scans (Snyk/Trivy/Semgrep/SARIF) or manual
  sbom                Submit SPDX or CycloneDX Software Bill of Materials (--file)

ARTIFACTS
  artifact            Record a build artifact with SHA-256 fingerprint
  fingerprint         Calculate SHA-256 fingerprint (file|dir|docker)
  allow               Allowlist an artifact for environment compliance

ENVIRONMENTS
  snapshot            Capture runtime snapshot (docker|kubernetes|ecs|lambda|s3|azure|path|paths)
  environment         Manage environments (create|list|log|diff)

DEPLOYMENTS & GATES
  deploy              Record a deployment event
  gate                Check deployment gate — exit 0 if passed, exit 1 if failed
  approve             Approval workflow (request|report|check)

FLOWS & TRAILS
  flow                Manage delivery flows (create|list|get)
  trail               Manage delivery trails (create|attest|complete)

PIPELINES
  pipeline            Record a CI/CD pipeline run

COMPLIANCE
  policy              Manage compliance policies (create|attach|detach|list|evaluate|evaluate-input)

ASSERTIONS & EVALUATION
  assert              Assert compliance (artifact|snapshot|pullrequest|approval)
  expect              Pre-announce a deployment
  evaluate            Evaluate trail compliance (trail)
  tag                 Tag resources with metadata labels
  completion          Generate shell completion scripts (bash|zsh|fish|powershell)

STATUS
  status              Show comprehensive compliance status for a repo or commit

SEARCH & DISCOVERY
  search              Search by artifact fingerprint or commit SHA
  ask                 Ask a natural-language question about change evidence

DRIFT DETECTION
  drift               Detect drift between expected and actual environment state

RESOURCE MANAGEMENT
  get                 Get details of a resource (artifact|flow|trail|approval|environment)
  list                List resources (artifacts|flows|trails|approvals|environments|attestation-types)
  attestation-type    Manage custom attestation types (create|list|get)
  archive             Archive a flow or environment (with confirmation)
  rename              Rename a flow or environment

ENVIRONMENT VARIABLES
  MERGEWHY_API_KEY    API key (required) — generate at https://mergewhy.com/dashboard/settings
  MERGEWHY_API_URL    API base URL (default: https://mergewhy.com)

CI AUTO-DETECTION
  Auto-detects: GitHub Actions, GitLab CI, Jenkins, CircleCI,
  Azure Pipelines, Bitbucket Pipelines, TeamCity, Travis CI

  When running in CI, --repo, --commit, --branch, and --pr are auto-populated.

EXAMPLES
  # Record test results (generic)
  mergewhy attest --type TEST_RESULTS --name "Unit Tests" --passed

  # Parse JUnit XML results
  mergewhy attest junit --results-dir ./test-reports --name "Unit Tests"

  # Parse Snyk security scan
  mergewhy attest snyk --scan-results snyk-report.json --name "Snyk"

  # Auto-detect and record test results
  mergewhy attest test
  mergewhy attest test --dir ./test-reports

  # Auto-detect and record security scan results
  mergewhy attest security
  mergewhy attest security --file trivy-report.json

  # Verify PR exists for this commit
  mergewhy attest pullrequest github --github-token $GITHUB_TOKEN

  # Record a Docker image with provenance
  mergewhy artifact --name "api-server" --sha256 a1b2c3... --type docker --tag v1.2.3

  # Fingerprint a file or directory
  mergewhy fingerprint file ./build/app.jar
  mergewhy fingerprint dir ./dist

  # Check deployment gate
  mergewhy gate --environment production --min-score 80

  # Request deployment approval
  mergewhy approve request --artifact-sha256 a1b2c3... --environment production

  # Capture runtime snapshots
  mergewhy snapshot docker --environment production
  mergewhy snapshot kubernetes --environment staging --namespace default
  mergewhy snapshot s3 --bucket my-artifacts --environment production
  mergewhy snapshot path --path /opt/myapp --exclude "*.log"

  # Manage environments
  mergewhy environment create --name production --type k8s
  mergewhy environment diff --name production --from snap_1 --to snap_2

  # Manage delivery flows and trails
  mergewhy flow create --name "Payment Service" --template flow.yaml
  mergewhy trail create --name "Release v2.1"
  mergewhy trail attest --trail-id abc123 --type TEST_RESULTS --name "E2E" --passed
  mergewhy trail complete --trail-id abc123

  # Submit SBOM
  mergewhy sbom --file sbom.cdx.json

  # Search by fingerprint or commit
  mergewhy search --fingerprint a1b2c3d4...
  mergewhy search --commit abc123

  # Ask a question about change evidence
  mergewhy ask "what changed in production last week?"
  mergewhy ask "which PRs are missing approvals?" --repo owner/repo

  # Detect environment drift
  mergewhy drift --environment production
  mergewhy drift --environment staging --repo owner/repo

  # Get and list resources
  mergewhy get artifact --sha256 a1b2c3d4...
  mergewhy get flow --name "Payment Service"
  mergewhy list artifacts --repo owner/repo
  mergewhy list environments

  # Manage attestation types
  mergewhy attestation-type create --name "perf-test" --schema schema.json
  mergewhy attestation-type list

  # Archive and rename
  mergewhy archive flow --name "Old Service" --force
  mergewhy rename environment --name staging --new-name staging-v2

  # Manage policies
  mergewhy policy create --name "prod-gate" --file policy.yaml
  mergewhy policy create --name "rego-gate" --file gate.rego --format rego
  mergewhy policy attach --name "prod-gate" --environment production
  mergewhy policy evaluate --name "prod-gate" --input input.json
  mergewhy policy evaluate-input --policy gate.rego --input input.json

  # Allowlist a third-party artifact
  mergewhy allow --artifact-sha256 a1b2... --environment production --reason "Vendor image"

  # Assert compliance
  mergewhy assert artifact --sha256 a1b2c3... --environment production
  mergewhy assert snapshot --environment production
  mergewhy assert pullrequest github --repository owner/repo --commit abc123
  mergewhy assert approval --sha256 a1b2c3... --environment production

  # Pre-announce a deployment
  mergewhy expect --environment production --artifact-sha256 a1b2c3...

  # Evaluate trail compliance
  mergewhy evaluate trail --flow "Payment Service"

  # Tag resources
  mergewhy tag --resource-type artifact --resource-id abc123 --tags "release:v2.1,team:payments"

  # Generate shell completions
  mergewhy completion bash >> ~/.bashrc

OPTIONS
  --help, -h       Show this help message
  --version, -v    Show version
`.trim());
}

main().catch((err: Error) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
