# Getting Started

## Prerequisites
1. Create an API key through the developer portal
2. Ensure your key has the required scopes
3. Bind your key to a user if accessing user-specific data

## Making Your First Request

```bash
curl -X GET "https://your-domain.com/api/v1/market?symbol=BTCUSDT" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json"
```

## Authentication
All requests require API key authentication via Bearer token. See [Authentication](./authentication.md) for details.

## Scopes
Different endpoints require different scopes. Ensure your key has the necessary permissions.

## Error Handling
Errors follow a standard format:
```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Error description",
    "details": []
  },
  "requestId": "req_..."
}
```

## Rate Limits
Rate limits are enforced per tenant and API key. Exceeding limits returns 429 status.

## Next Steps
- [Authentication](./authentication.md)
- [API Reference](./reference.md)
- [Error Codes](./errors.md)
