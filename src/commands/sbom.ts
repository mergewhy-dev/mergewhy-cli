/**
 * mergewhy sbom — Submit a Software Bill of Materials
 *
 * Usage:
 *   mergewhy sbom --file sbom.json --format spdx --repo owner/repo --commit abc123
 *   mergewhy sbom --file sbom.cdx.json --format cyclonedx --artifact-sha256 abc123...
 */

import { loadConfig, apiRequest, formatSuccess, formatError } from "../client.js";
import { detectCI } from "../ci-detect.js";
import { readFileSync } from "fs";

const VALID_FORMATS = ["spdx", "cyclonedx", "custom"] as const;

export async function sbomCommand(args: string[]): Promise<void> {
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

  const file = opts.file as string;
  if (!file) {
    formatError("--file is required (path to SBOM file)");
    process.exit(1);
  }

  let sbomContent: string;
  try {
    sbomContent = readFileSync(file, "utf-8");
  } catch {
    formatError(`Cannot read file: ${file}`);
    process.exit(1);
  }

  let sbomData: Record<string, unknown>;
  try {
    sbomData = JSON.parse(sbomContent);
  } catch {
    formatError("SBOM file must be valid JSON");
    process.exit(1);
  }

  // Auto-detect format
  let format = (opts.format as string || "").toLowerCase();
  if (!format) {
    if (sbomData.spdxVersion || sbomData.SPDXID) {
      format = "spdx";
    } else if (sbomData.bomFormat === "CycloneDX") {
      format = "cyclonedx";
    } else {
      format = "custom";
    }
  }

  if (!VALID_FORMATS.includes(format as typeof VALID_FORMATS[number])) {
    formatError(`Invalid format "${opts.format}". Valid: ${VALID_FORMATS.join(", ")}`);
    process.exit(1);
  }

  const repo = (opts.repo as string) || ci?.repo;
  const commitSha = (opts.commit as string) || ci?.commitSha;

  // Extract component count from SBOM
  let componentCount = 0;
  if (format === "spdx" && Array.isArray(sbomData.packages)) {
    componentCount = (sbomData.packages as unknown[]).length;
  } else if (format === "cyclonedx" && Array.isArray(sbomData.components)) {
    componentCount = (sbomData.components as unknown[]).length;
  }

  const body: Record<string, unknown> = {
    type: "SBOM",
    name: `SBOM (${format.toUpperCase()})`,
    passed: true,
    evidence: {
      format,
      componentCount,
      sbom: sbomData,
    },
    source: ci?.provider || "cli",
    repositoryName: repo,
    commitSha,
    ...(opts["artifact-sha256"] && { artifactSha256: opts["artifact-sha256"] }),
  };

  const result = await apiRequest(config, "POST", "/api/v1/attestations", body);

  if (result.ok) {
    formatSuccess(`SBOM submitted: ${format.toUpperCase()} (${componentCount} components)`, {
      id: result.data.id as string,
      format,
      components: String(componentCount),
      repo: repo || "auto-linked",
    });
  } else {
    formatError(`Failed to submit SBOM: ${result.data.error || result.status}`, result.data);
    process.exit(1);
  }
}
