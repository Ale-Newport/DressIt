export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details: unknown;
  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export const notFound = (what = 'Recurso') => new AppError(404, 'not_found', `${what} no encontrado.`);
export const badRequest = (message: string, details?: unknown) => new AppError(400, 'bad_request', message, details);
export const unauthorized = (message = 'Sesión no válida o caducada.') => new AppError(401, 'unauthorized', message);
export const forbidden = (message = 'No tienes permiso para esta acción.') => new AppError(403, 'forbidden', message);
export const conflict = (message: string) => new AppError(409, 'conflict', message);
export const unavailable = (message: string, details?: unknown) => new AppError(503, 'dependency_unavailable', message, details);
