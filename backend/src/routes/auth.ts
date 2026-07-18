/**
 * Auth routes — POST /api/v1/auth/login, GET /api/v1/auth/me
 */
import { Router, type Request, type Response } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { generateToken, authMiddleware } from '../middleware/auth.js';
import { asyncHandler, ApiError } from '../middleware/errorHandler.js';
import type { AuthRequest } from '../middleware/auth.js';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

/** Strict rate limit for login: 10 attempts per 15 minutes per IP. */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { status: 429, title: 'Too Many Requests', detail: 'Too many login attempts. Try again in 15 minutes.' },
  keyGenerator: (req) => req.ip || 'unknown',
});

export const authRouter: import('express').Router = Router();

/** POST /login — validate credentials, return JWT. */
authRouter.post(
  '/login',
  loginLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      throw ApiError.badRequest('Invalid request body');
    }

    const { email, password } = parsed.data;
    const adminEmail = process.env.ADMIN_EMAIL;
    const adminHash = process.env.ADMIN_PASSWORD_HASH;

    if (!adminEmail || email !== adminEmail) {
      throw ApiError.unauthorized('Invalid email or password');
    }

    if (process.env.MOCK_DATA === '1' || process.env.NODE_ENV === 'test') {
      // In mock/test mode, accept "admin" as password
      if (password !== 'admin') {
        throw ApiError.unauthorized('Invalid email or password');
      }
    } else {
      if (!adminHash) {
        throw ApiError.internal('Authentication not configured — ADMIN_PASSWORD_HASH missing');
      }
      const valid = await bcrypt.compare(password, adminHash);
      if (!valid) {
        throw ApiError.unauthorized('Invalid email or password');
      }
    }

    const tokenResponse = generateToken();
    res.json(tokenResponse);
  }),
);

/** GET /me — return current authenticated user info. */
authRouter.get(
  '/me',
  authMiddleware,
  (req: AuthRequest, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    res.json({ email: req.user.email, role: req.user.role });
  },
);
