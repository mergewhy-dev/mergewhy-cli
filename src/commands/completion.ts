/**
 * mergewhy completion — Generate shell completion scripts
 *
 * Usage:
 *   mergewhy completion bash
 *   mergewhy completion zsh
 *   mergewhy completion fish
 *   mergewhy completion powershell
 *
 * Install:
 *   mergewhy completion bash >> ~/.bashrc
 *   mergewhy completion zsh >> ~/.zshrc
 *   mergewhy completion fish > ~/.config/fish/completions/mergewhy.fish
 */

import { formatError } from "../client.js";

const COMMANDS = [
  "attest",
  "artifact",
  "fingerprint",
  "allow",
  "snapshot",
  "environment",
  "deploy",
  "gate",
  "approve",
  "pipeline",
  "flow",
  "trail",
  "policy",
  "sbom",
  "search",
  "assert",
  "expect",
  "evaluate",
  "tag",
  "completion",
];

const ATTEST_SUBCOMMANDS = ["junit", "snyk", "sonar", "jira", "pullrequest", "pr", "custom"];
const APPROVE_SUBCOMMANDS = ["request", "report", "check"];
const ASSERT_SUBCOMMANDS = ["artifact", "snapshot", "pullrequest", "pr", "approval"];
const EVALUATE_SUBCOMMANDS = ["trail"];
const SNAPSHOT_TYPES = ["docker", "kubernetes", "ecs", "lambda", "s3", "azure", "path", "paths"];
const ENVIRONMENT_SUBCOMMANDS = ["create", "list", "log", "diff"];
const FLOW_SUBCOMMANDS = ["create", "list", "get"];
const TRAIL_SUBCOMMANDS = ["create", "attest", "complete"];
const POLICY_SUBCOMMANDS = ["create", "attach", "detach", "list"];
const FINGERPRINT_SUBCOMMANDS = ["file", "dir", "docker"];
const COMPLETION_SHELLS = ["bash", "zsh", "fish", "powershell"];

export async function completionCommand(args: string[]): Promise<void> {
  const shell = args[0]?.toLowerCase();

  if (!shell || shell === "--help" || shell === "-h") {
    printHelp();
    return;
  }

  switch (shell) {
    case "bash":
      console.log(generateBash());
      break;
    case "zsh":
      console.log(generateZsh());
      break;
    case "fish":
      console.log(generateFish());
      break;
    case "powershell":
      console.log(generatePowershell());
      break;
    default:
      formatError(`Unknown shell "${shell}". Use: bash, zsh, fish, powershell`);
      process.exit(1);
  }
}

function generateBash(): string {
  return `# mergewhy bash completion
# Install: mergewhy completion bash >> ~/.bashrc

_mergewhy() {
  local cur prev commands
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"

  commands="${COMMANDS.join(" ")}"

  case "\${COMP_WORDS[1]}" in
    attest)
      COMPREPLY=( $(compgen -W "${ATTEST_SUBCOMMANDS.join(" ")}" -- "$cur") )
      return 0
      ;;
    approve)
      COMPREPLY=( $(compgen -W "${APPROVE_SUBCOMMANDS.join(" ")}" -- "$cur") )
      return 0
      ;;
    assert)
      COMPREPLY=( $(compgen -W "${ASSERT_SUBCOMMANDS.join(" ")}" -- "$cur") )
      return 0
      ;;
    evaluate)
      COMPREPLY=( $(compgen -W "${EVALUATE_SUBCOMMANDS.join(" ")}" -- "$cur") )
      return 0
      ;;
    snapshot)
      COMPREPLY=( $(compgen -W "${SNAPSHOT_TYPES.join(" ")}" -- "$cur") )
      return 0
      ;;
    environment|env)
      COMPREPLY=( $(compgen -W "${ENVIRONMENT_SUBCOMMANDS.join(" ")}" -- "$cur") )
      return 0
      ;;
    flow)
      COMPREPLY=( $(compgen -W "${FLOW_SUBCOMMANDS.join(" ")}" -- "$cur") )
      return 0
      ;;
    trail)
      COMPREPLY=( $(compgen -W "${TRAIL_SUBCOMMANDS.join(" ")}" -- "$cur") )
      return 0
      ;;
    policy)
      COMPREPLY=( $(compgen -W "${POLICY_SUBCOMMANDS.join(" ")}" -- "$cur") )
      return 0
      ;;
    fingerprint)
      COMPREPLY=( $(compgen -W "${FINGERPRINT_SUBCOMMANDS.join(" ")}" -- "$cur") )
      return 0
      ;;
    completion)
      COMPREPLY=( $(compgen -W "${COMPLETION_SHELLS.join(" ")}" -- "$cur") )
      return 0
      ;;
  esac

  if [ "$COMP_CWORD" -eq 1 ]; then
    COMPREPLY=( $(compgen -W "$commands" -- "$cur") )
  fi

  return 0
}

complete -F _mergewhy mergewhy`;
}

function generateZsh(): string {
  return `#compdef mergewhy
# mergewhy zsh completion
# Install: mergewhy completion zsh >> ~/.zshrc

_mergewhy() {
  local -a commands
  commands=(
${COMMANDS.map((c) => `    '${c}:${getCommandDescription(c)}'`).join("\n")}
  )

  local -a attest_subcommands
  attest_subcommands=(${ATTEST_SUBCOMMANDS.map((s) => `'${s}'`).join(" ")})

  local -a approve_subcommands
  approve_subcommands=(${APPROVE_SUBCOMMANDS.map((s) => `'${s}'`).join(" ")})

  local -a assert_subcommands
  assert_subcommands=(${ASSERT_SUBCOMMANDS.map((s) => `'${s}'`).join(" ")})

  local -a evaluate_subcommands
  evaluate_subcommands=(${EVALUATE_SUBCOMMANDS.map((s) => `'${s}'`).join(" ")})

  local -a snapshot_types
  snapshot_types=(${SNAPSHOT_TYPES.map((s) => `'${s}'`).join(" ")})

  _arguments -C \\
    '1:command:->command' \\
    '*::arg:->args'

  case $state in
    command)
      _describe 'command' commands
      ;;
    args)
      case \${words[1]} in
        attest) _describe 'subcommand' attest_subcommands ;;
        approve) _describe 'subcommand' approve_subcommands ;;
        assert) _describe 'subcommand' assert_subcommands ;;
        evaluate) _describe 'subcommand' evaluate_subcommands ;;
        snapshot) _describe 'type' snapshot_types ;;
        completion) _describe 'shell' '(bash zsh fish powershell)' ;;
      esac
      ;;
  esac
}

compdef _mergewhy mergewhy`;
}

function generateFish(): string {
  const lines: string[] = [
    "# mergewhy fish completion",
    "# Install: mergewhy completion fish > ~/.config/fish/completions/mergewhy.fish",
    "",
    "# Disable file completions for mergewhy",
    "complete -c mergewhy -f",
    "",
    "# Top-level commands",
  ];

  for (const cmd of COMMANDS) {
    lines.push(
      `complete -c mergewhy -n '__fish_use_subcommand' -a '${cmd}' -d '${getCommandDescription(cmd)}'`
    );
  }

  lines.push("");
  lines.push("# Subcommands");

  const subcommandMap: Record<string, string[]> = {
    attest: ATTEST_SUBCOMMANDS,
    approve: APPROVE_SUBCOMMANDS,
    assert: ASSERT_SUBCOMMANDS,
    evaluate: EVALUATE_SUBCOMMANDS,
    snapshot: SNAPSHOT_TYPES,
    environment: ENVIRONMENT_SUBCOMMANDS,
    flow: FLOW_SUBCOMMANDS,
    trail: TRAIL_SUBCOMMANDS,
    policy: POLICY_SUBCOMMANDS,
    fingerprint: FINGERPRINT_SUBCOMMANDS,
    completion: COMPLETION_SHELLS,
  };

  for (const [cmd, subs] of Object.entries(subcommandMap)) {
    for (const sub of subs) {
      lines.push(
        `complete -c mergewhy -n '__fish_seen_subcommand_from ${cmd}' -a '${sub}'`
      );
    }
  }

  return lines.join("\n");
}

function generatePowershell(): string {
  return `# mergewhy PowerShell completion
# Install: mergewhy completion powershell >> $PROFILE

Register-ArgumentCompleter -CommandName mergewhy -ScriptBlock {
  param($wordToComplete, $commandAst, $cursorPosition)

  $commands = @(${COMMANDS.map((c) => `'${c}'`).join(", ")})

  $subcommands = @{
    'attest' = @(${ATTEST_SUBCOMMANDS.map((s) => `'${s}'`).join(", ")})
    'approve' = @(${APPROVE_SUBCOMMANDS.map((s) => `'${s}'`).join(", ")})
    'assert' = @(${ASSERT_SUBCOMMANDS.map((s) => `'${s}'`).join(", ")})
    'evaluate' = @(${EVALUATE_SUBCOMMANDS.map((s) => `'${s}'`).join(", ")})
    'snapshot' = @(${SNAPSHOT_TYPES.map((s) => `'${s}'`).join(", ")})
    'environment' = @(${ENVIRONMENT_SUBCOMMANDS.map((s) => `'${s}'`).join(", ")})
    'flow' = @(${FLOW_SUBCOMMANDS.map((s) => `'${s}'`).join(", ")})
    'trail' = @(${TRAIL_SUBCOMMANDS.map((s) => `'${s}'`).join(", ")})
    'policy' = @(${POLICY_SUBCOMMANDS.map((s) => `'${s}'`).join(", ")})
    'fingerprint' = @(${FINGERPRINT_SUBCOMMANDS.map((s) => `'${s}'`).join(", ")})
    'completion' = @(${COMPLETION_SHELLS.map((s) => `'${s}'`).join(", ")})
  }

  $elements = $commandAst.CommandElements
  $command = if ($elements.Count -gt 1) { $elements[1].ToString() } else { $null }

  if ($command -and $subcommands.ContainsKey($command)) {
    $subcommands[$command] | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
      [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
    }
  } else {
    $commands | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
      [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
    }
  }
}`;
}

function getCommandDescription(cmd: string): string {
  const descriptions: Record<string, string> = {
    attest: "Record an attestation",
    artifact: "Record a build artifact",
    fingerprint: "Calculate SHA-256 fingerprint",
    allow: "Allowlist an artifact",
    snapshot: "Capture runtime snapshot",
    environment: "Manage environments",
    deploy: "Record a deployment",
    gate: "Check deployment gate",
    approve: "Approval workflow",
    pipeline: "Record pipeline run",
    flow: "Manage delivery flows",
    trail: "Manage delivery trails",
    policy: "Manage compliance policies",
    sbom: "Submit SBOM",
    search: "Search artifacts and commits",
    assert: "Assert compliance",
    expect: "Pre-announce deployment",
    evaluate: "Evaluate trail compliance",
    tag: "Tag resources",
    completion: "Generate shell completions",
  };
  return descriptions[cmd] || cmd;
}

function printHelp(): void {
  console.log(`
mergewhy completion — Generate shell completion scripts

USAGE
  mergewhy completion <shell>

SHELLS
  bash         Generate bash completion script
  zsh          Generate zsh completion script
  fish         Generate fish completion script
  powershell   Generate PowerShell completion script

INSTALL
  mergewhy completion bash >> ~/.bashrc
  mergewhy completion zsh >> ~/.zshrc
  mergewhy completion fish > ~/.config/fish/completions/mergewhy.fish
  mergewhy completion powershell >> $PROFILE
`.trim());
}
