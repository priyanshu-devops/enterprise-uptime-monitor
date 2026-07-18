/**
 * JWT authentication middleware.
 * Verifies Bearer token and attaches user to request.
 */
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import pino from 'pino';
import type { LoginResponse } from '@uptime/shared';

const logger = pino({ name: 'auth' });

/** JWT payload shape. */
interface JwtPayload {
  email: string;
  role: 'admin';
  iat: number;
  exp: number;
}

/** Extended request with user info. */
export interface AuthRequest extends Request {
  user?: JwtPayload;
}

/** Middleware to protect routes – throws 401/403 on failure. */
export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({
      status: 401,
      title: 'Unauthorized',
      detail: 'Missing or invalid Authorization header',
    });
    return;
  }

  const token = authHeader.slice(7);
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    logger.error('JWT_SECRET not configured');
    res.status(500).json({ status: 500, title: 'Server Error', detail: 'Auth not configured' });
    return;
  }

  try {
    const payload = jwt.verify(token, secret) as JwtPayload;
    if (payload.email !== process.env.ADMIN_EMAIL) {
      res.status(403).json({ status: 403, title: 'Forbidden', detail: 'Email mismatch' });
      return;
    }
    req.user = payload;
    next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      res.status(401).json({ status: 401, title: 'Unauthorized', detail: 'Token expired' });
    } else {
      res.status(401).json({ status: 401, title: 'Unauthorized', detail: 'Invalid token' });
    }
  }
}

/** Generate a JWT token for the admin user. */
export function generateToken(): LoginResponse {
  const secret = process.env.JWT_SECRET;
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!secret || !adminEmail) {
    throw new Error('Auth configuration missing');
  }
  const expiresIn = process.env.JWT_EXPIRES_IN || '24h';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const token = jwt.sign({ email: adminEmail, role: 'admin' }, secret, { expiresIn } as any);
  return { token, expiresIn, user: { email: adminEmail, role: 'admin' } };
}
