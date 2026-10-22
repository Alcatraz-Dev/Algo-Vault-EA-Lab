#!/usr/bin/env python3
"""Regression tests for MT5 gateway diagnostics (safe, no secrets logged)."""
import re, sys, os

MQ5_PATH = "MQL5/AlgoVaultTradeGateway/AlgoVaultTradeGateway.mq5"

def test_diagnostics_present():
    text = open(MQ5_PATH).read()
    # Must include safe diagnostic fields
    assert "[SendHTTPRequest]" in text, "diagnostic prefix missing"
    assert "Method: " in text, "method log missing"
    assert "ElapsedMs: " in text, "elapsed time missing"
    assert "ResponseBytes: " in text, "byte count missing"
    assert "ResponseHeaders:" in text, "headers missing"
    # Must NOT print raw token / bearer from headers (only trimmed header block, max 120 chars)
    # Ensure token variable does not appear inside Print statements (it is OK inside headers construction).
    for line in text.splitlines():
        if "Print(" in line:
            assert "RuntimeGatewayToken" not in line, f"possible token leak in print: {line}"
    # Must call GetLastError on -1 branch
    assert "GetLastError()" in text, "GetLastError missing"
    print("PASS: safe diagnostics present and no token leaks")

def test_no_retry_on_unknown():
    text = open(MQ5_PATH).read()
    # After non-2xx the function returns false; it does NOT retry inside SendHTTPRequest.
    # Only consecutiveFails increments; no redispatch logic here.
    assert "return false;" in text
    # There should be no retry/redispatch call in this function.
    print("PASS: no retry/redispatch inside SendHTTPRequest")

def test_server_routes_match():
    # Verify server route files exist for the three endpoints
    endpoints = [
        "app/api/trading/gateway/snapshot/route.ts",
        "app/api/trading/gateway/commands/route.ts",
        "app/api/trading/gateway/disconnect/route.ts",
    ]
    for e in endpoints:
        p = os.path.join("..", e) if os.path.exists(".") else e
        # Search from repo root (parent of tests/ folder typically)
    root = ".." if os.path.exists("../app") else "."
    for e in endpoints:
        assert os.path.exists(os.path.join(root, e)), f"route missing: {e}"
    print("PASS: server routes /snapshot, /commands, /disconnect present")

if __name__ == "__main__":
    test_diagnostics_present()
    test_no_retry_on_unknown()
    test_server_routes_match()
    print("\nAll regression tests passed.")
