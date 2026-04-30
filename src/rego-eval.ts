/**
 * Lightweight Rego subset evaluator for common DevOps policy patterns.
 *
 * Supports:
 *   - `default <name> = <value>`
 *   - `<name> { ... }` rules with AND-combined conditions
 *   - `violation[msg] { ... }` set-generating rules
 *   - Field access: `input.field`, `input.nested.field`
 *   - Comparison: ==, !=, <, >, <=, >=
 *   - `count(expr)` function
 *   - `contains(string, substring)` function
 *   - `startswith(string, prefix)` / `endswith(string, suffix)`
 *   - `not <condition>` negation
 *   - `msg := "..."` assignment within violation rules
 *   - String, number, boolean, null literals
 *
 * This is NOT a full OPA implementation. It covers the 90% case for
 * DevOps gate policies (score thresholds, boolean checks, array length).
 */

export interface RegoEvalResult {
  passed: boolean;
  violations: Array<{ rule: string; message: string }>;
  bindings: Record<string, unknown>;
}

interface ParsedRule {
  name: string;
  isSet: boolean; // violation[msg] style
  setVar: string | null; // "msg" in violation[msg]
  conditions: string[];
  assignment: { variable: string; value: string } | null;
}

interface ParsedDefault {
  name: string;
  value: unknown;
}

interface ParsedPolicy {
  defaults: ParsedDefault[];
  rules: ParsedRule[];
}

// ── Parsing ──────────────────────────────────────────────────────────────

function stripComments(source: string): string {
  return source
    .split("\n")
    .map((line) => {
      // Remove line comments (# ...) but not inside strings
      let inString = false;
      let quote = "";
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inString) {
          if (ch === quote && line[i - 1] !== "\\") inString = false;
        } else if (ch === '"' || ch === "'") {
          inString = true;
          quote = ch;
        } else if (ch === "#") {
          return line.slice(0, i);
        }
      }
      return line;
    })
    .join("\n");
}

function parsePolicy(source: string): ParsedPolicy {
  const clean = stripComments(source);
  const defaults: ParsedDefault[] = [];
  const rules: ParsedRule[] = [];

  // Match `default <name> = <value>`
  const defaultRegex = /^default\s+(\w+)\s*=\s*(.+)$/gm;
  let match: RegExpExecArray | null;
  while ((match = defaultRegex.exec(clean)) !== null) {
    defaults.push({
      name: match[1],
      value: parseLiteral(match[2].trim()),
    });
  }

  // Match rule blocks: `<name> { ... }` and `<name>[<var>] { ... }`
  // Use a manual scanner because rules can span multiple lines
  const lines = clean.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();

    // Skip default lines, package, import, empty
    if (
      !line ||
      line.startsWith("default ") ||
      line.startsWith("package ") ||
      line.startsWith("import ")
    ) {
      i++;
      continue;
    }

    // Match: `rulename { ...` or `rulename[var] { ...`
    const ruleStart = line.match(/^(\w+)(?:\[(\w+)\])?\s*\{(.*)$/);
    if (ruleStart) {
      const name = ruleStart[1];
      const setVar = ruleStart[2] || null;
      const isSet = setVar !== null;

      // Collect body lines until closing `}`
      let bodyContent = ruleStart[3];
      let braceDepth = 1;

      // Count braces in the rest of the first line
      for (const ch of ruleStart[3]) {
        if (ch === "{") braceDepth++;
        if (ch === "}") braceDepth--;
      }

      if (braceDepth > 0) {
        i++;
        while (i < lines.length && braceDepth > 0) {
          const bl = lines[i];
          for (const ch of bl) {
            if (ch === "{") braceDepth++;
            if (ch === "}") braceDepth--;
          }
          if (braceDepth > 0) {
            bodyContent += "\n" + bl;
          } else {
            // Add content before the closing brace
            const closingIdx = bl.lastIndexOf("}");
            bodyContent += "\n" + bl.slice(0, closingIdx);
          }
          i++;
        }
      } else {
        // Single-line rule: remove trailing }
        const closingIdx = bodyContent.lastIndexOf("}");
        if (closingIdx >= 0) {
          bodyContent = bodyContent.slice(0, closingIdx);
        }
        i++;
      }

      // Parse body into conditions + optional assignment
      const conditions: string[] = [];
      let assignment: { variable: string; value: string } | null = null;

      const bodyLines = bodyContent
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0);

      for (const bl of bodyLines) {
        // Check for assignment: `msg := "something"`
        const assignMatch = bl.match(/^(\w+)\s*:=\s*(.+)$/);
        if (assignMatch) {
          assignment = { variable: assignMatch[1], value: assignMatch[2].trim() };
          continue;
        }
        conditions.push(bl);
      }

      rules.push({ name, isSet, setVar, conditions, assignment });
      continue;
    }

    i++;
  }

  return { defaults, rules };
}

// ── Literal parsing ──────────────────────────────────────────────────────

function parseLiteral(s: string): unknown {
  const trimmed = s.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  // Quoted string
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

// ── Expression evaluation ────────────────────────────────────────────────

function resolveFieldAccess(expr: string, input: Record<string, unknown>): unknown {
  const trimmed = expr.trim();

  // Literal values
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  // Function calls
  const funcMatch = trimmed.match(/^(\w+)\((.+)\)$/);
  if (funcMatch) {
    return evalFunction(funcMatch[1], funcMatch[2], input);
  }

  // Field access: input.foo.bar or just foo.bar
  let path = trimmed;
  if (path.startsWith("input.")) {
    path = path.slice(6);
  }

  const parts = path.split(".");
  let current: unknown = input;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current === "object" && current !== null) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return current;
}

function evalFunction(
  name: string,
  argsStr: string,
  input: Record<string, unknown>
): unknown {
  // Parse function arguments (simple comma split — no nested function support needed)
  const args = splitFuncArgs(argsStr).map((a) => resolveFieldAccess(a.trim(), input));

  switch (name) {
    case "count": {
      const val = args[0];
      if (Array.isArray(val)) return val.length;
      if (typeof val === "string") return val.length;
      if (typeof val === "object" && val !== null) return Object.keys(val).length;
      return 0;
    }
    case "contains": {
      const str = String(args[0] ?? "");
      const sub = String(args[1] ?? "");
      return str.includes(sub);
    }
    case "startswith": {
      const str = String(args[0] ?? "");
      const prefix = String(args[1] ?? "");
      return str.startsWith(prefix);
    }
    case "endswith": {
      const str = String(args[0] ?? "");
      const suffix = String(args[1] ?? "");
      return str.endsWith(suffix);
    }
    default:
      throw new Error(`Unsupported Rego function: ${name}()`);
  }
}

function splitFuncArgs(argsStr: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of argsStr) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      args.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) args.push(current);
  return args;
}

// ── Condition evaluation ─────────────────────────────────────────────────

const COMPARISON_OPS = ["!=", "==", ">=", "<=", ">", "<"] as const;

function evaluateCondition(
  condition: string,
  input: Record<string, unknown>,
  bindings: Record<string, unknown>
): boolean {
  const trimmed = condition.trim();

  // Handle `not` prefix
  if (trimmed.startsWith("not ")) {
    return !evaluateCondition(trimmed.slice(4), input, bindings);
  }

  // Handle comparison operators
  for (const op of COMPARISON_OPS) {
    const idx = trimmed.indexOf(` ${op} `);
    if (idx === -1) continue;

    const left = trimmed.slice(0, idx).trim();
    const right = trimmed.slice(idx + op.length + 2).trim();

    const leftVal = resolveFieldAccess(left, input);
    const rightVal = resolveFieldAccess(right, input);

    switch (op) {
      case "==":
        return leftVal === rightVal;
      case "!=":
        return leftVal !== rightVal;
      case ">":
        return Number(leftVal) > Number(rightVal);
      case "<":
        return Number(leftVal) < Number(rightVal);
      case ">=":
        return Number(leftVal) >= Number(rightVal);
      case "<=":
        return Number(leftVal) <= Number(rightVal);
    }
  }

  // Bare expression — truthy check
  const val = resolveFieldAccess(trimmed, input);
  return !!val;
}

// ── Main evaluator ───────────────────────────────────────────────────────

export function evaluateRego(
  source: string,
  input: Record<string, unknown>
): RegoEvalResult {
  const policy = parsePolicy(source);

  // Initialize bindings from defaults
  const bindings: Record<string, unknown> = {};
  for (const def of policy.defaults) {
    bindings[def.name] = def.value;
  }

  const violations: Array<{ rule: string; message: string }> = [];

  // Evaluate each rule
  for (const rule of policy.rules) {
    const allConditionsMet = rule.conditions.every((cond) =>
      evaluateCondition(cond, input, bindings)
    );

    if (rule.isSet) {
      // Set-generating rule (e.g., violation[msg])
      // Only fires when ALL conditions are met
      if (allConditionsMet) {
        let message = rule.name;
        if (rule.assignment) {
          const assignVal = resolveFieldAccess(rule.assignment.value, input);
          message = String(assignVal ?? rule.assignment.value);
          // Strip surrounding quotes if present
          if (
            (message.startsWith('"') && message.endsWith('"')) ||
            (message.startsWith("'") && message.endsWith("'"))
          ) {
            message = message.slice(1, -1);
          }
        }
        violations.push({ rule: rule.name, message });
      }
    } else {
      // Scalar rule (e.g., allow { ... })
      // If conditions pass, the rule value becomes true
      if (allConditionsMet) {
        bindings[rule.name] = true;
      }
      // If conditions fail, default value (or undefined) is kept
    }
  }

  // Determine pass/fail: `allow` binding is the conventional gate
  const passed = bindings.allow === true;

  return { passed, violations, bindings };
}
