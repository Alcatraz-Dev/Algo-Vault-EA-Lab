import fs from "node:fs";
import path from "node:path";

const ROOT_DIR = process.cwd();

interface ValidationIssue {
  file: string;
  type: "error" | "warning";
  message: string;
}

const issues: ValidationIssue[] = [];

function checkFileExists(relPath: string): boolean {
  const fullPath = path.join(ROOT_DIR, relPath);
  if (!fs.existsSync(fullPath)) {
    issues.push({
      file: relPath,
      type: "error",
      message: "Required SEO/AI file does not exist.",
    });
    return false;
  }
  return true;
}

function checkNoSecrets(relPath: string) {
  const fullPath = path.join(ROOT_DIR, relPath);
  if (!fs.existsSync(fullPath)) return;
  const content = fs.readFileSync(fullPath, "utf-8");

  const secretPatterns = [
    /sk_live_[0-9a-zA-Z]{24}/,
    /sk_test_[0-9a-zA-Z]{24}/,
    /PRIVATE KEY-----/,
    /firebase-adminsdk/,
    /AIzaSy[0-9a-zA-Z-_]{33}/,
  ];

  for (const pattern of secretPatterns) {
    if (pattern.test(content)) {
      issues.push({
        file: relPath,
        type: "error",
        message: `Secret pattern match detected: ${pattern}`,
      });
    }
  }
}

function checkCanonicalName(relPath: string) {
  const fullPath = path.join(ROOT_DIR, relPath);
  if (!fs.existsSync(fullPath)) return;
  const content = fs.readFileSync(fullPath, "utf-8");

  if (!content.includes("AlgoVault")) {
    issues.push({
      file: relPath,
      type: "warning",
      message: "Canonical brand name 'AlgoVault' not found in file.",
    });
  }
}

console.log("=========================================");
console.log("AlgoVault SEO, AI Search & Security Auditor");
console.log("=========================================\n");

const requiredFiles = [
  "app/robots.ts",
  "app/sitemap.ts",
  "public/robots.txt",
  "public/llms.txt",
  "public/llms-full.txt",
  "public/ai-search.txt",
  "public/ai-agent.txt",
  "public/ai.txt",
  "public/.well-known/security.txt",
  "public/humans.txt",
  "lib/public-docs.ts",
  "lib/security/rate-limiter.ts",
  "lib/security/api-classifier.ts",
];

for (const relFile of requiredFiles) {
  if (checkFileExists(relFile)) {
    checkNoSecrets(relFile);
    checkCanonicalName(relFile);
  }
}

if (issues.length === 0) {
  console.log("✅ ALL CHECKS PASSED SUCCESSFULLY!");
  console.log("All SEO foundation, AI knowledge files, security policies, and documentation hubs are present and free of secret leaks.\n");
  process.exit(0);
} else {
  console.log(`Found ${issues.length} issue(s):\n`);
  for (const issue of issues) {
    const icon = issue.type === "error" ? "❌" : "⚠️";
    console.log(`${icon} [${issue.file}] ${issue.message}`);
  }
  const hasErrors = issues.some((i) => i.type === "error");
  process.exit(hasErrors ? 1 : 0);
}
