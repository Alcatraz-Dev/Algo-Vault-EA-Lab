# @algovault/sdk

Official TypeScript SDK for the AlgoVault Intelligence Cloud API.

## Installation

```bash
npm install @algovault/sdk
```

Or with yarn/pnpm. Note: This package is not published to npm in this milestone - use via workspace.

## Configuration

```typescript
import { AlgoVault } from '@algovault/sdk';

const client = new AlgoVault({
  apiKey: process.env.ALGOVAULT_API_KEY!,
  baseUrl: process.env.ALGOVAULT_API_BASE_URL || 'https://algovault.app', // optional; configure for your deployment
  timeout: 30000, // optional, defaults to 30000ms
});
```

**Important:** Never expose your API key in browser/client-side code. Use environment variables in server-side code only.

## Quick Start

```typescript
// Get market data
const market = await client.market.get({ symbol: 'EURUSD', timeframe: '1H' });

// Get indicators
const indicators = await client.indicators.get({ symbol: 'EURUSD', timeframe: '1H' });

// Get smart money data
const smartMoney = await client.smartMoney.get({ symbol: 'EURUSD' });

// Get analytics
const analytics = await client.analytics.get({ symbol: 'EURUSD' });

// Validate a strategy
const validation = await client.strategies.validate({
  symbol: 'EURUSD',
  timeframe: '1H',
  rules: {}
});

// Research
const jobs = await client.research.list();
const job = await client.research.create({ symbol: 'EURUSD', objective: 'analyze' });
const result = await client.research.get(job.jobId!);

// Accounts and positions (requires appropriate scopes/ownership)
const accounts = await client.accounts.get();
const positions = await client.accounts.positions();
```

## API Groups

- `client.market` - Market data, graph, relationships
- `client.indicators` - Technical indicators
- `client.analytics` - Portfolio analytics
- `client.smartMoney` - Smart money analysis
- `client.strategies` - Strategy validation
- `client.research` - Research jobs (list, create, retrieve)
- `client.accounts` - Accounts and positions

## Error Handling

```typescript
import { AlgoVault, AlgoVaultError, AlgoVaultAuthError, AlgoVaultRateLimitError } from '@algovault/sdk';

try {
  const data = await client.market.get({ symbol: 'EURUSD' });
} catch (error) {
  if (error instanceof AlgoVaultAuthError) {
    // Handle authentication error
  } else if (error instanceof AlgoVaultRateLimitError) {
    // Handle rate limit - check error.retryAfter
    console.log('Retry after:', error.retryAfter);
  } else if (error instanceof AlgoVaultError) {
    // Handle other API errors
  }
}
```

## Features

- Typed request parameters and responses
- API key authentication via Bearer token
- Configurable base URL and timeouts
- Automatic retry for rate-limited GET requests with Retry-After support
- Safe handling - no automatic retry for non-idempotent POST requests
- Request cancellation via AbortSignal
- Network error handling
- Built-in error types

## Security

- Never commit API keys
- API keys are sent via Authorization header
- Server-only credentials - do not use in browser/client bundles
