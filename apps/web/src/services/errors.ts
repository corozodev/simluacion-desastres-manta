export class ApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status?: number,
    public readonly requestId?: string,
    public readonly details: { field: string; message: string }[] = [],
  ) { super(message); this.name = 'ApiError'; }
}
