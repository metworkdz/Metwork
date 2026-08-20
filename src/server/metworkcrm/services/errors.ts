/**
 * Errors thrown by METWORK OS CRM services. Caught at the route handler
 * boundary and translated to the API error envelope (`@/server/http/json`).
 */
export class CrmServiceError extends Error {
  public readonly code: string;
  public readonly status: number;
  public readonly details?: Record<string, unknown>;

  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'CrmServiceError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class CrmNotFoundError extends CrmServiceError {
  constructor(entity: string) {
    super(404, 'CRM_NOT_FOUND', `${entity} introuvable.`);
    this.name = 'CrmNotFoundError';
  }
}
