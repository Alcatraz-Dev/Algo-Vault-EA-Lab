// AlgoVault SEO, AI & Security Unit Test Runner
import assert from "node:assert";
import { checkRateLimit } from "../lib/security/rate-limiter";
import { classifyApiRoute } from "../lib/security/api-classifier";
import { getAllPublicDocs, getPublicDocBySlug } from "../lib/public-docs";

console.log("=========================================");
console.log("Running AlgoVault SEO, AI & Security Tests");
console.log("=========================================\n");

// Test 1: Rate Limiter
console.log("Test 1: Rate Limiter Window & Tokens");
const res1 = checkRateLimit("test-client-ip-1", { windowMs: 1000, max: 2 });
assert.strictEqual(res1.success, true, "First request should succeed");
assert.strictEqual(res1.remaining, 1, "Remaining tokens should be 1");

const res2 = checkRateLimit("test-client-ip-1", { windowMs: 1000, max: 2 });
assert.strictEqual(res2.success, true, "Second request should succeed");
assert.strictEqual(res2.remaining, 0, "Remaining tokens should be 0");

const res3 = checkRateLimit("test-client-ip-1", { windowMs: 1000, max: 2 });
assert.strictEqual(res3.success, false, "Third request should fail rate limit");
console.log("  ✓ Rate Limiter verified successfully.");

// Test 2: API Route Classification
console.log("\nTest 2: API Route Security Classification");
const cronMeta = classifyApiRoute("/api/growth/cron/daily");
assert.strictEqual(cronMeta.classification, "CRON");

const adminMeta = classifyApiRoute("/api/admin/users");
assert.strictEqual(adminMeta.classification, "ADMIN");

const defaultMeta = classifyApiRoute("/api/private-data");
assert.strictEqual(defaultMeta.classification, "AUTHENTICATED");
console.log("  ✓ API Classifications verified successfully.");

// Test 3: Public Documentation Engine
console.log("\nTest 3: Public Documentation Engine");
const allDocs = getAllPublicDocs();
assert(allDocs.length >= 5, "Public docs count should be >= 5");

const smcDoc = getPublicDocBySlug("smart-money-methodology");
assert(smcDoc !== undefined, "Smart Money Concept doc should be retrievable");
assert.strictEqual(smcDoc?.category, "Market Intelligence");
console.log("  ✓ Public Documentation engine verified successfully.");

console.log("\n✅ ALL TESTS COMPLETED SUCCESSFULLY!");
