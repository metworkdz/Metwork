/**
 * Errors thrown by payment providers. Caught at the route handler /
 * service boundary and translated to API error responses.
 */
export class ProviderError extends Error {
  /** Stable machine-readable code (e.g. PROVIDER_NOT_CONFIGURED). */
  public readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
  }
}

export class ProviderNotConfiguredError extends ProviderError {
  constructor(provider: string) {
    super(
      'PROVIDER_NOT_CONFIGURED',
      `Payment provider "${provider}" is not configured. Set the required env vars or switch PAYMENT_PROVIDER.`,
    );
    this.name = 'ProviderNotConfiguredError';
  }
}

export class ProviderRequestError extends ProviderError {
  public readonly status: number | null;
  constructor(message: string, status: number | null = null) {
    super('PROVIDER_REQUEST_FAILED', message);
    this.name = 'ProviderRequestError';
    this.status = status;
  }
}
