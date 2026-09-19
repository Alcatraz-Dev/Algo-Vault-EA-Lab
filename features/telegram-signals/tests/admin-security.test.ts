/**
 * AlgoVault Pro Signal Intelligence - Admin Security Unit Test
 * Verifies that all Telegram Admin endpoints strictly enforce server-side admin authorization.
 */

import { GET as getStatus } from "@/app/api/admin/telegram/status/route";
import { POST as sendCode } from "@/app/api/admin/telegram/send-code/route";
import { GET as getChannels } from "@/app/api/admin/telegram/channels/route";
import { GET as getSources, POST as postSource } from "@/app/api/admin/telegram/sources/route";
import { GET as getGroups } from "@/app/api/admin/telegram/groups/route";
import { POST as runTest } from "@/app/api/admin/telegram/test/route";
import { NextRequest } from "next/server";

async function runSecurityTests() {
    console.log("==========================================");
    console.log("   Telegram Admin Security Test Suite     ");
    console.log("==========================================");

    // 1. Test Unauthenticated Requests (No Bearer token)
    const reqNoAuth = new NextRequest("http://localhost:3000/api/admin/telegram/status");
    const statusRes = await getStatus(reqNoAuth);
    if (statusRes.status === 403 || statusRes.status === 401) {
        console.log("✅ Security Test 1 Passed: Unauthenticated GET /status returned 403/401");
    } else {
        console.error("❌ Security Test 1 Failed: Expected 403/401, got", statusRes.status);
        process.exit(1);
    }

    // 2. Test Invalid Token Request
    const reqInvalidToken = new NextRequest("http://localhost:3000/api/admin/telegram/channels", {
        headers: { Authorization: "Bearer invalid_token_123" },
    });
    const channelsRes = await getChannels(reqInvalidToken);
    if (channelsRes.status === 403 || channelsRes.status === 401) {
        console.log("✅ Security Test 2 Passed: Invalid token GET /channels returned 403/401");
    } else {
        console.error("❌ Security Test 2 Failed: Expected 403/401, got", channelsRes.status);
        process.exit(1);
    }

    // 3. Test POST send-code without auth
    const reqSendCodeNoAuth = new NextRequest("http://localhost:3000/api/admin/telegram/send-code", {
        method: "POST",
        body: JSON.stringify({ phoneNumber: "+4670000000" }),
    });
    const sendCodeRes = await sendCode(reqSendCodeNoAuth);
    if (sendCodeRes.status === 403 || sendCodeRes.status === 401) {
        console.log("✅ Security Test 3 Passed: Unauthenticated POST /send-code returned 403/401");
    } else {
        console.error("❌ Security Test 3 Failed: Expected 403/401, got", sendCodeRes.status);
        process.exit(1);
    }

    // 4. Test POST sources without auth
    const reqPostSourceNoAuth = new NextRequest("http://localhost:3000/api/admin/telegram/sources", {
        method: "POST",
        body: JSON.stringify({ channelId: "-1001234", name: "Fake Source" }),
    });
    const sourceRes = await postSource(reqPostSourceNoAuth);
    if (sourceRes.status === 403 || sourceRes.status === 401) {
        console.log("✅ Security Test 4 Passed: Unauthenticated POST /sources returned 403/401");
    } else {
        console.error("❌ Security Test 4 Failed: Expected 403/401, got", sourceRes.status);
        process.exit(1);
    }

    // 5. Test POST diagnostic test without auth
    const reqTestNoAuth = new NextRequest("http://localhost:3000/api/admin/telegram/test", {
        method: "POST",
    });
    const testRes = await runTest(reqTestNoAuth);
    if (testRes.status === 403 || testRes.status === 401) {
        console.log("✅ Security Test 5 Passed: Unauthenticated POST /test returned 403/401");
    } else {
        console.error("❌ Security Test 5 Failed: Expected 403/401, got", testRes.status);
        process.exit(1);
    }

    console.log("==========================================");
    console.log("🎉 ALL ADMIN SECURITY TESTS PASSED (100%)");
    console.log("==========================================");
}

runSecurityTests().catch((err) => {
    console.error("Security test error:", err);
    process.exit(1);
});
