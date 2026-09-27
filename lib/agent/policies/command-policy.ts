// ─────────────────────────────────────────────────────────────────────────────
// AlgoVault Agent IDE — Command Policy / Classifier
//
// Every terminal command the agent wants to run is decomposed into pipeline
// segments and classified here BEFORE execution. There is no hidden unrestricted
// shell: the terminal tool refuses anything this module does not classify as
// `safe`, and `restricted` still needs an explicit human confirmation recorded
// through the approval layer. Classification is a pure function of the command
// string so it is fully unit-testable.
//
// Classes:
//   safe       → run automatically inside the sandbox
//   restricted → requires explicit human confirmation (git commit, npm install
//                of known-scoped packages, file deletes via rm of a single file…)
//   blocked    → never executable by the agent (destructive, production,
//                credential access, network exfil, escalation, etc.)
// ─────────────────────────────────────────────────────────────────────────────

import path from "node:path";

export type CommandClass = "safe" | "restricted" | "blocked";

export interface CommandVerdict {
    cls: CommandClass;
    /** Machine-readable reason code, stable across releases for tests. */
    code: string;
    /** Human/agent-facing explanation (never includes command output). */
    message: string;
}

// ── Allowlist: demonstrably safe project-local commands ──────────────────────

/** Package-manager runners accepted for project scripts. */
const RUNNERS = new Set(["npm", "pnpm", "yarn", "npx", "bun", "bunx", "node", "jiti"]);

/** Project scripts that are known-safe (read/test/build — no deploy, no publish). */
const SAFE_SCRIPTS = new Set([
    "test", "test:ai", "test:ea", "test:growth", "test:marketing", "test:account-health",
    "lint", "typecheck", "tsc", "build", "dev", "start", "check",
]);

// ── Block patterns: evaluated per pipeline segment, case-insensitive ─────────

interface Rule {
    code: string;
    message: string;
    test: (argv: string[], raw: string) => boolean;
}

const BLOCK_RULES: Rule[] = [
    {
        code: "rm_recursive_or_forced",
        message: "Recursive or forced deletion is destructive and blocked.",
        test: (argv) =>
            /^(rm|rmdir|shred)$/.test(argv[0]) &&
            argv.slice(1).some((a) => a.startsWith("-") && (a.includes("r") || a.includes("f") || a === "--recursive" || a === "--force")),
    },
    {
        code: "rm_wildcard",
        message: "Deletion with wildcards or absolute targets is blocked.",
        test: (argv, raw) =>
            /^(rm|rmdir|shred|unlink)$/.test(argv[0]) &&
            (/[*?]/.test(raw) || argv.some((a) => path.isAbsolute(a))),
    },
    {
        code: "disk_format",
        message: "Disk or volume operations are blocked.",
        test: (argv) => /^(mkfs|fdisk|diskutil|diskpart|dd|mount|umount|diskutil|format)$/.test(argv[0]),
    },
    {
        code: "git_history_rewrite",
        message: "Rewriting git history (reset/rebase/clean/filter) is blocked.",
        test: (argv) => argv[0] === "git" && /^(reset|rebase|filter-branch|filter-repo|clean|gc|prune)$/.test(argv[1] ?? ""),
    },
    {
        code: "git_push",
        message: "Git push is blocked by policy. Commits may be prepared and proposed only.",
        test: (argv) => argv[0] === "git" && /^push$/.test(argv[1] ?? ""),
    },
    {
        code: "git_force",
        message: "Force flags on git are blocked.",
        test: (argv, raw) => argv[0] === "git" && /--force|^-f\b/.test(raw),
    },
    {
        code: "deploy_command",
        message: "Deployment commands are blocked. Deployments happen out-of-band with human ownership.",
        test: (argv, raw) =>
            /^(vercel|netlify|firebase|gcloud|aws|az|heroku|fly|railway|render|supabase|wrangler|now)$/.test(argv[0]) ||
            /\b(deploy|publish|release|upload)\b/i.test(raw) && /^(npm|pnpm|yarn|bun)$/.test(argv[0]),
    },
    {
        code: "env_secret_read",
        message: "Reading credential or secret files is blocked.",
        test: (argv) =>
            /^(cat|head|tail|less|more|strings|xxd|hexdump|base64|od)$/.test(argv[0]) &&
            argv.slice(1).some((a) => /(^|\/)\.env|\.pem$|\.key$|\.p12$|\.pfx$|id_rsa|id_ed25519|service-account|credentials\.json|secrets\./i.test(a)),
    },
    {
        code: "credential_cli",
        message: "Credential stores and keychains are blocked.",
        test: (argv) =>
            /^(security|ssh-add|git\s+credential|pass|gpg|--razor|keychain)$/.test(argv.join(" ")) ||
            argv[0] === "security" || argv[0] === "ssh-add" ||
            (argv[0] === "git" && argv[1] === "credential"),
    },
    {
        code: "system_admin",
        message: "System administration commands are blocked.",
        test: (argv) => /^(sudo|doas|su|pkexec|launchctl|systemctl|service|sc|netsh|dscl|useradd|usermod|chmod\s+777)$/.test(argv.join(" ")) || /^(sudo|doas|su|pkexec)$/.test(argv[0]),
    },
    {
        code: "network_fetch",
        message: "Outbound network commands (curl/wget/ssh/scp) are blocked.",
        test: (argv) => /^(curl|wget|ssh|scp|sftp|rsync|nc|ncat|telnet|ftp|ping|dig|nslookup)$/.test(argv[0]),
    },
    {
        code: "process_kill",
        message: "Killing or signalling processes is blocked.",
        test: (argv) => /^(kill|killall|pkill|taskkill|shutdown|reboot|halt)$/.test(argv[0]),
    },
    {
        code: "env_mutation",
        message: "Mutating environment or shell config is blocked.",
        test: (argv) => /^(export|unset|setenv|source|\.)$/.test(argv[0]) || argv[0] === "source",
    },
    {
        code: "redirect_out_of_project",
        message: "Writing output outside the project workspace is blocked.",
        test: (argv, raw) =>
            /[>|]{1,2}\s*\/(?!(tmp|dev)\/)/.test(raw) ||
            argv.some((a) => a.startsWith(">") && path.isAbsolute(a.slice(1)) && !/^\>\/(tmp|dev)\//.test(a)),
    },
    {
        code: "code_execution_inline",
        message: "Inline eval-style execution is blocked (write a project file and run it instead).",
        test: (argv) => argv[0] === "node" && argv.slice(1).some((a) => /^-e|--eval|--inspect-brk=/.test(a)),
    },
    {
        code: "package_scripts_arbitrary",
        message: "Only known-safe project scripts can run without confirmation.",
        test: (argv) =>
            RUNNERS.has(argv[0]) &&
            argv.length > 1 &&
            argv[1] === "run" &&
            !SAFE_SCRIPTS.has(argv[2] ?? ""),
    },
    {
        code: "npx_arbitrary_package",
        message: "Executing an arbitrary package through npx/bunx requires confirmation.",
        test: (argv) => {
            if (!/^(npx|bunx)$/.test(argv[0]) || argv.length <= 1) return false;
            const second = argv[1] ?? "";
            // Local binaries / toolchain flags are fine; package specs are not.
            if (second.startsWith("-") || second === "tsc" || second === "eslint" || second === "next" || second === "jiti") return false;
            if (!second.includes("@") && !second.includes("/") && SAFE_SCRIPTS.has(second)) return false;
            return true;
        },
    },
];

const RESTRICT_RULES: Rule[] = [
    {
        code: "package_install",
        message:
            "Package installation changes the dependency graph — explicit confirmation required.",
        test: (argv) =>
            RUNNERS.has(argv[0]) &&
            argv.slice(1).some((a) => /^(i|install|add|un|remove|update|link|dedupe)$/.test(a)),
    },
    {
        code: "git_commit",
        message: "Git commit requires explicit confirmation.",
        test: (argv) => argv[0] === "git" && /^(commit|tag|stash)$/.test(argv[1] ?? ""),
    },
    {
        code: "file_delete",
        message: "File deletion requires explicit confirmation.",
        test: (argv) => /^(rm|unlink|shred)$/.test(argv[0]),
    },
    {
        code: "mkdir_mv_outside",
        message: "Moving files outside the workspace requires confirmation.",
        test: (argv) => /^(mv|cp)$/.test(argv[0]) && argv.slice(1).some((a) => path.isAbsolute(a)),
    },
    {
        code: "unknown_command",
        message: "Command is not on the safe allowlist — confirmation required.",
        test: (argv) => !RUNNERS.has(argv[0]) && !/^(git|ls|cat|head|tail|find|grep|rg|wc|node|which|echo|pwd|stat|du|df|date|env|printenv|tsc|eslint|next)$/.test(argv[0]),
    },
];

/** Shell metachars that indicate a compound command we must split and classify per segment. */
function splitPipeline(raw: string): string[] {
    // Split on `&&`, `||`, `;`, `|` — but not inside quotes.
    const segments: string[] = [];
    let current = "";
    let quote: string | null = null;
    for (let i = 0; i < raw.length; i++) {
        const ch = raw[i];
        if (quote) {
            current += ch;
            if (ch === quote) quote = null;
            continue;
        }
        if (ch === '"' || ch === "'") {
            quote = ch;
            current += ch;
            continue;
        }
        if (ch === ";" || ch === "|") {
            segments.push(current);
            current = "";
            // skip `&&`/`||` second char
            if (raw[i + 1] === ch) i++;
            continue;
        }
        if (ch === "&" && raw[i + 1] === "&") {
            segments.push(current);
            current = "";
            i++;
            continue;
        }
        current += ch;
    }
    segments.push(current);
    return segments.map((s) => s.trim()).filter((s) => s.length > 0);
}

function tokenize(segment: string): string[] {
    const argv: string[] = [];
    let current = "";
    let quote: string | null = null;
    for (let i = 0; i < segment.length; i++) {
        const ch = segment[i];
        if (quote) {
            if (ch === quote) {
                quote = null;
            } else {
                current += ch;
            }
            continue;
        }
        if (ch === '"' || ch === "'") {
            quote = ch;
            continue;
        }
        if (/\s/.test(ch)) {
            if (current) argv.push(current);
            current = "";
            continue;
        }
        current += ch;
    }
    if (current) argv.push(current);
    return argv;
}

/**
 * Classify a raw command string. Compound commands inherit the WORST class of
 * any segment — one blocked segment blocks the whole command.
 */
export function classifyCommand(raw: string): CommandVerdict {
    if (typeof raw !== "string" || raw.trim() === "") {
        return { cls: "blocked", code: "empty_command", message: "Empty command." };
    }

    // Backticks or $() are command substitution → unresolvable at classification
    // time, therefore blocked (fail closed).
    if (/`|\$\(/.test(raw)) {
        return {
            cls: "blocked",
            code: "command_substitution",
            message: "Command substitution is not classifiable and is blocked (fail closed).",
        };
    }

    // Env-var assignment prefixes (VAR=value cmd) are unsupported by the
    // tokenizer — treat as unknown and restrict (or block if the base is blocked).
    const segments = splitPipeline(raw);
    let worst: CommandVerdict = { cls: "safe", code: "allowlisted", message: "All segments are allowlisted safe commands." };

    for (const segment of segments) {
        const verdict = classifySegment(segment);
        if (verdict.cls === "blocked") return verdict;
        if (verdict.cls === "restricted") worst = verdict;
    }
    return worst;
}

function classifySegment(segment: string): CommandVerdict {
    const argv = tokenize(segment);
    if (argv.length === 0) {
        return { cls: "safe", code: "empty_segment", message: "Empty segment." };
    }

    // Strip leading env assignments (VAR=x cmd) — the command itself is argv[0] after them.
    let idx = 0;
    while (idx < argv.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(argv[idx])) idx++;
    const effective = argv.slice(idx);
    if (effective.length === 0) {
        return { cls: "safe", code: "env_only", message: "Environment assignment only." };
    }

    const raw = segment;

    // Scoped env assignments to npm/pnpm scripts (e.g. FIREBASE_PROJECT_ID=… pnpm build)
    // are fine as long as the base command classifies safely — but the VALUE of
    // the assignment is redacted upstream, never echoed to the model.
    for (const rule of BLOCK_RULES) {
        let hit: boolean;
        try {
            hit = rule.test(effective, raw);
        } catch {
            hit = false;
        }
        if (hit) {
            return { cls: "blocked", code: rule.code, message: rule.message };
        }
    }

    for (const rule of RESTRICT_RULES) {
        let hit: boolean;
        try {
            hit = rule.test(effective, raw);
        } catch {
            hit = false;
        }
        if (hit) {
            return { cls: "restricted", code: rule.code, message: rule.message };
        }
    }

    // ── Positive allowlist check ────────────────────────────────────────────
    const head = effective[0];

    if (RUNNERS.has(head)) {
        // npm/pnpm/yarn run <script> — script must be in SAFE_SCRIPTS
        if (effective[1] === "run" || effective[1] === "test" || effective[1] === "lint" || effective[1] === "build" || effective[1] === "start" || effective[1] === "dev") {
            const scriptName = effective[1] === "run" ? effective[2] : effective[1];
            if (scriptName && SAFE_SCRIPTS.has(scriptName)) {
                return { cls: "safe", code: "allowlisted", message: "Project script is allowlisted." };
            }
            return {
                cls: "restricted",
                code: "unknown_script",
                message: `Project script "${scriptName ?? "?"}" is not on the safe list — confirmation required.`,
            };
        }
        // npx/bunx executing local toolchain binaries (tsc, eslint, next, jiti) is safe.
        if ((head === "npx" || head === "bunx") && (effective[1] === "tsc" || effective[1] === "eslint" || effective[1] === "next" || effective[1] === "jiti")) {
            return { cls: "safe", code: "allowlisted", message: "Project toolchain command." };
        }
        // node running a project script (jiti test runners) is safe.
        if (head === "node" && effective[1] === "scripts/jiti-tsrun.mjs") {
            return { cls: "safe", code: "allowlisted", message: "Project test runner." };
        }
        // Direct runner invocation without a recognized subcommand → restrict
        return {
            cls: "restricted",
            code: "runner_unknown_subcommand",
            message: "Package-runner subcommand is not recognized as safe — confirmation required.",
        };
    }

    if (head === "git") {
        const sub = effective[1] ?? "";
        const safeGit = new Set(["status", "diff", "log", "show", "branch", "rev-parse", "ls-files"]);
        const remoteListOnly = sub === "remote" && effective.length <= 3;
        const configGetOnly = sub === "config" && effective[2] === "--get";
        if (safeGit.has(sub) || remoteListOnly || configGetOnly) {
            return { cls: "safe", code: "git_read", message: "Read-only git command." };
        }
        return {
            cls: "restricted",
            code: "git_write",
            message: "Git mutation requires explicit confirmation.",
        };
    }

    if (["ls", "cat", "head", "tail", "find", "grep", "rg", "wc", "which", "echo", "pwd", "stat", "du", "df", "date", "env", "printenv"].includes(head)) {
        return { cls: "safe", code: "allowlisted", message: "Read-only command." };
    }

    if (head === "tsc" || head === "eslint" || head === "next" || head === "node") {
        return { cls: "safe", code: "allowlisted", message: "Project toolchain command." };
    }

    // Everything else → fail closed to restricted (never silently safe).
    return {
        cls: "restricted",
        code: "unclassified",
        message: "Command could not be classified as safe — confirmation required (fail closed).",
    };
}
