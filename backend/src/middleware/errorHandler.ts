/**
 * Global error handler middleware.
 * Normalizes errors to RFC 7807 Problem Details format.
 */
import { Request, Response, NextFunction } from 'express';
import pino from 'pino';

// Define our own ApiError class (no import conflict)
export class ApiError extends Error {
  readonly status: number;
  readonly title: string;
  readonly errors?: Record<string, string[]>;

  constructor(status: number, title: string, detail: string, errors?: Record<string, string[]>) {
    super(detail);
    this.name = 'ApiError';
    this.status = status;
    this.title = title;
    this.errors = errors;
  }

  static badRequest(detail: string, errors?: Record<string, string[]>): ApiError {
    return new ApiError(400, 'Bad Request', detail, errors);
  }

  static unauthorized(detail = 'Unauthorized'): ApiError {
    return new ApiError(401, 'Unauthorized', detail);
  }

  static forbidden(detail = 'Forbidden'): ApiError {
    return new ApiError(403, 'Forbidden', detail);
  }

  static notFound(detail = 'Resource not found'): ApiError {
    return new ApiError(404, 'Not Found', detail);
  }

  static conflict(detail: string): ApiError {
    return new ApiError(409, 'Conflict', detail);
  }

  static tooManyRequests(detail = 'Too many requests'): ApiError {
    return new ApiError(429, 'Too Many Requests', detail);
  }

  static internal(detail = 'Internal server error'): ApiError {
    return new ApiError(500, 'Internal Server Error', detail);
  }

  static serviceUnavailable(detail = 'Service temporarily unavailable'): ApiError {
    return new ApiError(503, 'Service Unavailable', detail);
  }
}

const logger = pino({ name: 'error-handler' });

/**
 * Async handler wrapper to catch async errors.
 */
export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Global error handler.
 */
export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  // Log the error
  logger.error({ err, message: err.message, stack: err.stack }, 'Request error');

  // Handle known API errors
  if (err instanceof ApiError) {
    const response = {
      status: err.status,
      title: err.title,
      detail: err.message,
      errors: err.errors,
    };
    res.status(err.status).json(response);
    return;
  }

  // Handle Zod validation errors
  if (err.name === 'ZodError' && 'issues' in err) {
    const zodErr = err as { issues: Array<{ path: (string | number)[]; message: string }> };
    const errors: Record<string, string[]> = {};
    for (const issue of zodErr.issues) {
      const path = issue.path.join('.');
      if (!errors[path]) errors[path] = [];
      errors[path].push(issue.message);
    }
    res.status(400).json({
      status: 400,
      title: 'Validation Error',
      detail: 'Request validation failed',
      errors,
    });
    return;
  }

  // Handle Google API errors (generic)
  if (err.name === 'GoogleAPIError' || (err.message && err.message.includes('Google API'))) {
    res.status(503).json({
      status: 503,
      title: 'Service Unavailable',
      detail: 'Google Sheets API error. Please try again later.',
    });
    return;
  }

  // Handle rate limit/quota errors
  if (err.message && (err.message.includes('429') || err.message.includes('rate limit') || err.message.includes('quota'))) {
    res.status(429).json({
      status: 429,
      title: 'Too Many Requests',
      detail: 'Google Sheets API quota exceeded. Please wait and retry.',
    });
    return;
  }

  // Default: internal server error
  res.status(500).json({
    status: 500,
    title: 'Internal Server Error',
    detail: process.env.NODE_ENV === 'production' ? 'An unexpected error occurred' : err.message,
  });
}
