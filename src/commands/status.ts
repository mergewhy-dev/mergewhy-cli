/**
 * mergewhy status — Show comprehensive compliance status for a commit or repository
 *
 * Usage:
 *   mergewhy status --repo owner/repo
 *   mergewhy status --commit abc123 --repo owner/repo
 *   mergewhy status --environment production --min-score 80
 */

import { loadConfig, apiRequest, formatSuccess, formatError } from "../client.js";
import { detectCI } from "../ci-detect.js";

export async function statusCommand(args: string[]): Promise<void> {
  const config = loadConfig();
  const ci = detectCI();

  const opts: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (!next || next.startsWith("--")) {
        opts[key] = true;
      } else {
        opts[key] = next;
        i++;
      }
    }
  }

  const repo = (opts.repo as string) || ci?.repo;
  const commitSha = (opts.commit as string) || ci?.commitSha;
  const environment = (opts.environment as string) || (opts.env as string) || "production";
  const minScore = opts["min-score"]
    ? parseInt(opts["min-score"] as string, 10)
    : 80;

  if (!repo) {
    formatError("--repo is required (or run in CI for auto-detection)");
    process.exit(1);
  }

  // Run gate check and search in parallel
  const gateParams = new URLSearchParams({
    environment,
    "min-score": minScore.toString(),
    repository: repo,
    ...(commitSha && { commit: commitSha }),
  });

  const searchParams = new URLSearchParams({
    ...(commitSha && { commit: commitSha }),
    ...(!commitSha && repo && { repository: repo }),
  });

  const [gateResult, searchResult] = await Promise.all([
    apiRequest(config, "GET", `/api/v1/gate?${gateParams.toString()}`),
    apiRequest(config, "GET", `/api/v1/search?${searchParams.toString()}`).catch(() => ({
      ok: false,
      status: 0,
      data: {} as Record<string, unknown>,
    })),
  ]);

  const output: Record<string, unknown> = {
    repository: repo,
    environment,
    ...(commitSha && { commit: commitSha }),
  };

  // Gate status
  if (gateResult.ok) {
    const gate = gateResult.data as Record<string, unknown>;
    output.gate = {
      allowed: gate.allowed,
      score: gate.score,
      threshold: minScore,
      reason: gate.reason,
      unresolvedGaps: gate.unresolvedGaps,
    };
    if (gate.complianceStatus) {
      output.compliance = gate.complianceStatus;
    }
    if (gate.metrics) {
      output.metrics = gate.metrics;
    }
  } else {
    output.gate = { error: gateResult.data.error || `HTTP ${gateResult.status}` };
  }

  // Search results
  if (searchResult.ok && searchResult.data) {
    output.evidence = searchResult.data;
  }

  if (config.outputFormat === "json") {
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  // Text output
  console.log(`\nMergeWhy Status: ${repo}`);
  console.log(`Environment: ${environment}`);
  if (commitSha) console.log(`Commit: ${commitSha}`);
  console.log("");

  if (gateResult.ok) {
    const gate = gateResult.data as Record<string, unknown>;
    const allowed = gate.allowed as boolean;
    const icon = allowed ? "\x1b[32m✓ PASS\x1b[0m" : "\x1b[31m✗ FAIL\x1b[0m";
    console.log(`Gate: ${icon}`);
    console.log(`  Score: ${gate.score}/100 (threshold: ${minScore})`);
    console.log(`  Reason: ${gate.reason}`);

    const metrics = gate.metrics as Record<string, unknown> | undefined;
    if (metrics) {
      console.log(`  Changes: ${metrics.totalChanges}`);
      console.log(`  Vault sealed: ${metrics.vaultSealedPercent}%`);
      console.log(`  Compliance pass: ${metrics.compliancePassPercent}%`);
      console.log(`  Unresolved gaps: ${metrics.unresolvedGaps} (${metrics.criticalGaps} critical)`);
    }

    const compliance = gate.complianceStatus as Record<string, Record<string, number>> | undefined;
    if (compliance && Object.keys(compliance).length > 0) {
      console.log("\n  Compliance:");
      for (const [fw, stats] of Object.entries(compliance)) {
        const pct = stats.total > 0 ? Math.round((stats.pass / stats.total) * 100) : 0;
        console.log(`    ${fw}: ${stats.pass}/${stats.total} pass (${pct}%)`);
      }
    }

    if (!allowed) {
      process.exit(1);
    }
  } else {
    formatError(`Gate check failed: ${gateResult.data.error || gateResult.status}`);
    process.exit(1);
  }
}
