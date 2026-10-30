import { BadRequestException, Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

function canonicalPhone(value: unknown) {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (digits.length === 10) return `7${digits}`;
  if (digits.length === 11 && digits.startsWith('8')) return `7${digits.slice(1)}`;
  return digits;
}

@Injectable()
export class PhoneLoginOnlyMiddleware implements NestMiddleware {
  use(request: Request, _response: Response, next: NextFunction) {
    const body = request.body && typeof request.body === 'object' ? request.body as Record<string, unknown> : {};
    const raw = body.identifier ?? body.phone ?? body.email ?? '';
    const phone = canonicalPhone(raw);
    if (phone.length < 10 || phone.length > 15 || String(raw || '').includes('@')) {
      throw new BadRequestException('Введите телефон');
    }
    body.identifier = raw;
    next();
  }
}
