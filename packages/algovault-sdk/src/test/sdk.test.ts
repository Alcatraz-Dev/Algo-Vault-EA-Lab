import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AlgoVault } from '../client';
import { AlgoVaultAuthError, AlgoVaultRateLimitError, AlgoVaultTimeoutError } from '../errors';

describe('AlgoVault SDK', () => {
  let mockFetch: any;

  beforeEach(() => {
    mockFetch = vi.fn();
  });

  it('throws error if no api key provided', () => {
    expect(() => new AlgoVault({ apiKey: '' })).toThrow();
  });

  it('sends auth header with requests', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: 'test' }),
    });

    const client = new AlgoVault({ apiKey: 'test-key', fetch: mockFetch });
    await client.market.get({ symbol: 'EURUSD' });

    expect(mockFetch).toHaveBeenCalled();
    const call = mockFetch.mock.calls[0];
    expect(call[1].headers.Authorization).toBe('Bearer test-key');
  });

  it('builds correct URL with params', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });

    const client = new AlgoVault({ apiKey: 'test-key', fetch: mockFetch, baseUrl: 'http://localhost:3000' });
    await client.market.get({ symbol: 'EURUSD', timeframe: '1H' });

    const call = mockFetch.mock.calls[0];
    expect(call[0]).toContain('/api/v1/market');
    expect(call[0]).toContain('symbol=EURUSD');
  });

  it('handles 401 as auth error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ error: 'Unauthorized' }),
    });

    const client = new AlgoVault({ apiKey: 'bad-key', fetch: mockFetch });
    await expect(client.market.get({ symbol: 'EURUSD' })).rejects.toThrow(AlgoVaultAuthError);
  });

  it('handles 429 as rate limit error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      headers: new Headers({ 'retry-after': '60' }),
      json: async () => ({ error: 'Rate limited' }),
    });

    const client = new AlgoVault({ apiKey: 'test-key', fetch: mockFetch });
    await expect(client.market.get({ symbol: 'EURUSD' })).rejects.toThrow(AlgoVaultRateLimitError);
  });

  it('does not auto-retry POST requests', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Error' }),
    });

    const client = new AlgoVault({ apiKey: 'test-key', fetch: mockFetch });
    try {
      await client.research.create({ symbol: 'EURUSD' });
    } catch {}
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('handles POST for strategy validation', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ valid: true }),
    });

    const client = new AlgoVault({ apiKey: 'test-key', fetch: mockFetch });
    const result = await client.strategies.validate({ symbol: 'EURUSD' });
    expect(result).toEqual({ valid: true });
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/strategies/validate'),
      expect.objectContaining({ method: 'POST' })
    );
  });
});
