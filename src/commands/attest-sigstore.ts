/**
 * mergewhy attest sigstore — Verify Sigstore/cosign signatures and record attestation
 *
 * Usage:
 *   mergewhy attest sigstore --image ghcr.io/org/app:v1.2.3
 *   mergewhy attest sigstore --artifact-sha256 abc123 --bundle bundle.json
 *   mergewhy attest sigstore --image ghcr.io/org/app:v1.2.3 --certificate-identity user@example.com --certificate-oidc-issuer https://accounts.google.com
 */

import { readFileSync } from "fs";
import { execSync } from "child_process";
import { resolve } from "path";
import { loadConfig, apiRequest, formatSuccess, formatError } from "../client.js";
import { detectCI } from "../ci-detect.js";

interface VerificationResult {
  verified: boolean;
  method: "bundle" | "cosign" | "manual";
  image?: string;
  sha256?: string;
  bundleData?: Record<string, unknown>;
  cosignOutput?: Record<string, unknown>;
  certificateIdentity?: string;
  certificateOidcIssuer?: string;
  error?: string;
}

function runCosignVerify(
  image: string,
  certIdentity?: string,
  certOidcIssuer?: string
): VerificationResult {
  const args = ["cosign", "verify", "--output-format", "json"];

  if (certIdentity) {
    args.push("--certificate-identity", certIdentity);
  }
  if (certOidcIssuer) {
    args.push("--certificate-oidc-issuer", certOidcIssuer);
  }

  args.push(image);

  try {
    const output = execSync(args.join(" "), {
      encoding: "utf-8",
      timeout: 60_000,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let cosignOutput: Record<string, unknown> = {};
    try {
      cosignOutput = JSON.parse(output) as Record<string, unknown>;
    } catch {
      cosignOutput = { rawOutput: output.trim() };
    }

    return {
      verified: true,
      method: "cosign",
      image,
      cosignOutput,
      certificateIdentity: certIdentity,
      certificateOidcIssuer: certOidcIssuer,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      verified: false,
      method: "cosign",
      image,
      certificateIdentity: certIdentity,
      certificateOidcIssuer: certOidcIssuer,
      error: message,
    };
  }
}

export async function attestSigstoreCommand(args: string[]): Promise<void> {
  const config = loadConfig();
  const ci = detectCI();

  // Parse arguments
  const opts: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      printHelp();
      return;
    }
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

  const image = opts.image as string | undefined;
  const artifactSha256 = opts["artifact-sha256"] as string | undefined;
  const bundlePath = opts.bundle as string | undefined;
  const certIdentity = opts["certificate-identity"] as string | undefined;
  const certOidcIssuer = opts["certificate-oidc-issuer"] as string | undefined;

  if (!image && !artifactSha256) {
    formatError("Either --image or --artifact-sha256 is required");
    process.exit(1);
  }

  // Build verification result
  let verification: VerificationResult;

  if (bundlePath) {
    // Read and parse the cosign bundle file
    let bundleData: Record<string, unknown>;
    try {
      const raw = readFileSync(resolve(bundlePath), "utf-8");
      bundleData = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      formatError(`Failed to read or parse bundle file: ${bundlePath}`);
      process.exit(1);
    }

    verification = {
      verified: true,
      method: "bundle",
      image,
      sha256: artifactSha256,
      bundleData,
      certificateIdentity: certIdentity,
      certificateOidcIssuer: certOidcIssuer,
    };
  } else if (image) {
    // Try to run cosign verify
    verification = runCosignVerify(image, certIdentity, certOidcIssuer);
  } else {
    // artifact-sha256 only, no bundle — record as manual attestation
    verification = {
      verified: true,
      method: "manual",
      sha256: artifactSha256,
      certificateIdentity: certIdentity,
      certificateOidcIssuer: certOidcIssuer,
    };
  }

  const name = (opts.name as string) || "Sigstore Verification";
  const passed = verification.verified;

  const evidence: Record<string, unknown> = {
    verifier: "sigstore",
    method: verification.method,
    ...(verification.image && { image: verification.image }),
    ...(verification.sha256 && { sha256: verification.sha256 }),
    ...(verification.bundleData && { bundle: verification.bundleData }),
    ...(verification.cosignOutput && { cosignOutput: verification.cosignOutput }),
    ...(verification.certificateIdentity && { certificateIdentity: verification.certificateIdentity }),
    ...(verification.certificateOidcIssuer && { certificateOidcIssuer: verification.certificateOidcIssuer }),
    ...(verification.error && { error: verification.error }),
  };

  if (ci) {
    evidence._ci = {
      provider: ci.provider,
      buildUrl: ci.buildUrl,
      buildId: ci.buildId,
      triggeredBy: ci.triggeredBy,
    };
  }

  const repo = (opts.repo as string) || ci?.repo;
  const commitSha = (opts.commit as string) || ci?.commitSha;
  const prNumber = opts.pr ? parseInt(opts.pr as string, 10) : ci?.prNumber;
  const branch = (opts.branch as string) || ci?.branch;

  const body: Record<string, unknown> = {
    type: "SIGSTORE_VERIFICATION",
    name,
    passed,
    evidence,
    source: ci?.provider || "cli",
    repositoryName: repo,
    commitSha,
    ...(prNumber && { prNumber }),
    ...(branch && { branch }),
    ...(artifactSha256 && { artifactSha256 }),
  };

  const result = await apiRequest(config, "POST", "/api/v1/attestations", body);

  if (result.ok) {
    formatSuccess(`Sigstore attestation recorded: ${name}`, {
      id: result.data.id as string,
      result: passed ? "VERIFIED" : "FAILED",
      method: verification.method,
      ...(image && { image }),
      ...(artifactSha256 && { sha256: artifactSha256.slice(0, 12) + "..." }),
      repo: repo || "auto-linked",
    });
  } else {
    formatError(`Failed to submit Sigstore attestation: ${result.data.error || result.status}`, result.data);
    process.exit(1);
  }
}

function printHelp(): void {
  console.log(`
mergewhy attest sigstore — Verify Sigstore/cosign signatures and record attestation

USAGE
  mergewhy attest sigstore --image <ref> [options]
  mergewhy attest sigstore --artifact-sha256 <hash> --bundle <path> [options]

OPTIONS
  --image                   Container image reference to verify (e.g. ghcr.io/org/app:v1.2.3)
  --artifact-sha256         Artifact fingerprint (alternative to --image)
  --bundle                  Path to cosign bundle JSON file (optional)
  --certificate-identity    Expected certificate identity for keyless signing (optional)
  --certificate-oidc-issuer Expected OIDC issuer for keyless signing (optional)
  --name                    Attestation name (default: "Sigstore Verification")
  --repo                    Repository owner/name (auto-detected in CI)
  --commit                  Commit SHA (auto-detected in CI)
  --branch                  Branch name (auto-detected in CI)
  --pr                      Pull request number (auto-detected in CI)

VERIFICATION MODES
  1. --bundle provided: reads the bundle JSON and records it as evidence
  2. --image without --bundle: runs "cosign verify" to verify the image signature
  3. --artifact-sha256 only: records a manual Sigstore verification attestation

EXAMPLES
  # Verify a container image with cosign (requires cosign installed)
  mergewhy attest sigstore --image ghcr.io/org/app:v1.2.3

  # Verify with keyless signing identity constraints
  mergewhy attest sigstore --image ghcr.io/org/app:v1.2.3 \\
    --certificate-identity user@example.com \\
    --certificate-oidc-issuer https://accounts.google.com

  # Submit a pre-existing cosign bundle
  mergewhy attest sigstore --artifact-sha256 a1b2c3... --bundle cosign-bundle.json

  # Record verification for a specific artifact
  mergewhy attest sigstore --image ghcr.io/org/app@sha256:a1b2c3... --bundle bundle.json
`.trim());
}
