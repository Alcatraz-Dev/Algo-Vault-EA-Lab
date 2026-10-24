# Authentication

## API Key Authentication

The AlgoVault Intelligence Cloud API uses API key authentication via Bearer tokens.

### Supplying API Keys

Include your API key in the `Authorization` header:

```http
Authorization: Bearer YOUR_API_KEY
```

### Key Properties
- **Tenant-bound**: Keys are bound to a specific tenant
- **User-bound (where required)**: Some endpoints (e.g., `/api/v1/accounts`, `/api/v1/positions`) require keys with explicit user binding
- **Scoped**: Keys have specific permissions via scopes
- **Hashed storage**: Secrets are hashed (HMAC-SHA256) - never stored in plaintext
- **Expirable and revocable**: Keys can have expiration dates and can be revoked

### Available Scopes
- `market:read` - Market data access
- `indicators:read` - Technical indicators
- `smartmoney:read` - Smart money analysis
- `setups:read` - Setup data
- `strategy:read` / `strategy:write` - Strategy access
- `research:read` / `research:write` - Research jobs
- `risk:read` - Risk data
- `portfolio:read` / `portfolio:stress` / `portfolio:allocation` - Portfolio intelligence
- `usage:read` - Usage data
- `snapshot:read` - Snapshots
- `api:manage` - API key management

Execution scopes (`execution:*`) are never grantable via public API.

### User Binding Requirements
Endpoints that access user-specific data (accounts, positions) require keys with `ownerUserId` set. Unbound keys will fail with `FORBIDDEN`.

### Entitlements
Some features may require specific plan entitlements. Requests without required entitlements will be rejected.

### Rate Limiting
Rate limits are enforced per tenant/API key. Rate limit behavior is enforced by the Intelligence Cloud pipeline.

### Security Best Practices
- Never expose API keys in client-side code
- Rotate keys regularly
- Use least-privilege scopes
- Monitor usage
- Revoke compromised keys immediately

## Distinction from Other Auth
- **API Keys**: For programmatic access to Intelligence Cloud API
- **Firebase ID Tokens**: For interactive user authentication (developer portal, app)
- **TradingView MCP Bridge**: Separate authentication flow for extension

**Never** use Firebase tokens as API keys or vice versa.
