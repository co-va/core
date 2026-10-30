import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma.service';
import { TransactionalEmailService } from '../transactional-email/transactional-email.service';

const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
const RESEND_COOLDOWN_MS = 10 * 60 * 1000;
const PLATFORM_ORIGIN = 'https://app.va-tools.ru';
const ACCOUNT_ORIGIN = 'https://client.va-tools.ru';

type Kind = 'PLATFORM' | 'ACCOUNT';
type SubjectRow = { id: string; email: string; emailVerifiedAt: Date | null };
type TicketRow = {
  id: string;
  subjectKind: Kind;
  platformAccountId: string | null;
  accountId: string | null;
  email: string;
  expiresAt: Date;
  usedAt: Date | null;
};

function normalizeEmail(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function tokenHash(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
  })[char] || char);
}

@Injectable()
export class EmailVerificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly email: TransactionalEmailService,
  ) {}

  private async subject(kind: Kind, id: string): Promise<SubjectRow | null> {
    const table = kind === 'PLATFORM' ? 'PlatformAccount' : 'Account';
    const rows = await this.prisma.$queryRawUnsafe<SubjectRow[]>(
      `SELECT "id","email","emailVerifiedAt" FROM "${table}" WHERE "id"=$1 LIMIT 1`,
      id,
    );
    return rows[0] || null;
  }

  private async emailAvailable(kind: Kind, id: string, candidate: string) {
    if (kind === 'PLATFORM') {
      const rows = await this.prisma.$queryRawUnsafe<Array<{ id: string }>>(
        'SELECT "id" FROM "PlatformAccount" WHERE LOWER("email")=LOWER($1) AND "id"<>$2 LIMIT 1',
        candidate,
        id,
      );
      if (rows.length) throw new ConflictException('Этот email уже используется');
      return;
    }
    const rows = await this.prisma.$queryRawUnsafe<Array<{ accountId: string }>>(
      `SELECT "accountId" FROM "AccountContact"
       WHERE "type"='EMAIL' AND LOWER("value")=LOWER($1) AND "accountId"<>$2 LIMIT 1`,
      candidate,
      id,
    );
    if (rows.length) throw new ConflictException('Этот email уже используется');
  }

  private origin(kind: Kind) {
    const configured = kind === 'PLATFORM'
      ? String(process.env.FRONTEND_ORIGIN || '').trim()
      : String(process.env.ACCOUNT_APP_URL || '').trim();
    return (configured || (kind === 'PLATFORM' ? PLATFORM_ORIGIN : ACCOUNT_ORIGIN)).replace(/\/+$/, '');
  }

  private verifyUrl(kind: Kind, token: string) {
    return `${this.origin(kind)}/verify-email.html?kind=${kind === 'PLATFORM' ? 'platform' : 'account'}&token=${encodeURIComponent(token)}`;
  }

  private async createAndSend(kind: Kind, id: string, targetEmail: string) {
    const email = normalizeEmail(targetEmail);
    if (!validEmail(email)) throw new BadRequestException('Укажите корректный email');
    await this.emailAvailable(kind, id, email);

    const ownerField = kind === 'PLATFORM' ? 'platformAccountId' : 'accountId';
    const recent = await this.prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT "id" FROM "EmailVerificationTicket"
       WHERE "subjectKind"=$1 AND "${ownerField}"=$2 AND LOWER("email")=LOWER($3)
         AND "usedAt" IS NULL AND "expiresAt">NOW() AND "createdAt">$4
       ORDER BY "createdAt" DESC LIMIT 1`,
      kind,
      id,
      email,
      new Date(Date.now() - RESEND_COOLDOWN_MS),
    );
    if (recent.length) return { accepted: true, sent: false, throttled: true };

    const token = randomBytes(32).toString('base64url');
    const hash = tokenHash(token);
    const ticketId = randomBytes(18).toString('hex');
    const expiresAt = new Date(Date.now() + VERIFY_TTL_MS);

    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `UPDATE "EmailVerificationTicket" SET "usedAt"=NOW()
         WHERE "subjectKind"=$1 AND "${ownerField}"=$2 AND "usedAt" IS NULL`,
        kind,
        id,
      );
      await tx.$executeRawUnsafe(
        `INSERT INTO "EmailVerificationTicket"
          ("id","subjectKind","${ownerField}","email","tokenHash","expiresAt","createdAt")
         VALUES ($1,$2,$3,$4,$5,$6,NOW())`,
        ticketId,
        kind,
        id,
        email,
        hash,
        expiresAt,
      );
    });

    const url = this.verifyUrl(kind, token);
    await this.email.send({
      to: email,
      subject: 'Подтвердите email VA Tools',
      tag: 'email-verification',
      text: `Подтвердите email: ${url}\nСсылка действует 24 часа.`,
      html: `<p>Подтвердите email <strong>${escapeHtml(email)}</strong>.</p><p><a href="${escapeHtml(url)}">Подтвердить email</a></p><p>Ссылка действует 24 часа.</p>`,
    });
    return { accepted: true, sent: true, throttled: false };
  }

  async statusPlatform(id: string) {
    return this.status('PLATFORM', id);
  }

  async statusAccount(id: string) {
    return this.status('ACCOUNT', id);
  }

  private async status(kind: Kind, id: string) {
    const subject = await this.subject(kind, id);
    if (!subject) return { email: '', verified: false };
    return {
      email: normalizeEmail(subject.email),
      verified: Boolean(subject.emailVerifiedAt),
      emailVerifiedAt: subject.emailVerifiedAt?.toISOString() || '',
    };
  }

  async requestPlatform(id: string) {
    return this.requestCurrent('PLATFORM', id);
  }

  async requestAccount(id: string) {
    return this.requestCurrent('ACCOUNT', id);
  }

  private async requestCurrent(kind: Kind, id: string) {
    const subject = await this.subject(kind, id);
    if (!subject || subject.emailVerifiedAt) return { accepted: true, alreadyVerified: Boolean(subject?.emailVerifiedAt) };
    return this.createAndSend(kind, id, subject.email);
  }

  async changePlatform(id: string, value: unknown) {
    return this.change('PLATFORM', id, value);
  }

  async changeAccount(id: string, value: unknown) {
    return this.change('ACCOUNT', id, value);
  }

  private async change(kind: Kind, id: string, value: unknown) {
    const candidate = normalizeEmail(value);
    if (!validEmail(candidate)) throw new BadRequestException('Укажите корректный email');
    const subject = await this.subject(kind, id);
    if (!subject) throw new BadRequestException('Учётная запись не найдена');
    if (normalizeEmail(subject.email) === candidate && subject.emailVerifiedAt) {
      return { accepted: true, alreadyVerified: true };
    }
    return this.createAndSend(kind, id, candidate);
  }

  async confirmPlatform(value: unknown) {
    return this.confirm('PLATFORM', value);
  }

  async confirmAccount(value: unknown) {
    return this.confirm('ACCOUNT', value);
  }

  private async confirm(kind: Kind, value: unknown) {
    const token = String(value || '').trim();
    if (!token) throw new BadRequestException('Ссылка подтверждения недействительна');
    const rows = await this.prisma.$queryRawUnsafe<TicketRow[]>(
      `SELECT "id","subjectKind","platformAccountId","accountId","email","expiresAt","usedAt"
       FROM "EmailVerificationTicket" WHERE "tokenHash"=$1 LIMIT 1`,
      tokenHash(token),
    );
    const ticket = rows[0];
    if (!ticket || ticket.subjectKind !== kind || ticket.usedAt || ticket.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('Ссылка подтверждения недействительна или устарела');
    }
    const id = kind === 'PLATFORM' ? ticket.platformAccountId : ticket.accountId;
    if (!id) throw new BadRequestException('Ссылка подтверждения недействительна');
    const email = normalizeEmail(ticket.email);
    await this.emailAvailable(kind, id, email);

    await this.prisma.$transaction(async (tx) => {
      if (kind === 'PLATFORM') {
        await tx.$executeRawUnsafe(
          'UPDATE "PlatformAccount" SET "email"=$1,"emailVerifiedAt"=NOW(),"updatedAt"=NOW() WHERE "id"=$2',
          email,
          id,
        );
      } else {
        const accountRows = await tx.$queryRawUnsafe<Array<{ email: string }>>(
          'SELECT "email" FROM "Account" WHERE "id"=$1 LIMIT 1',
          id,
        );
        const previousEmail = normalizeEmail(accountRows[0]?.email || '');
        await tx.$executeRawUnsafe(
          'UPDATE "Account" SET "email"=$1,"emailVerifiedAt"=NOW(),"updatedAt"=NOW() WHERE "id"=$2',
          email,
          id,
        );
        await tx.$executeRawUnsafe(
          `UPDATE "AccountContact" SET "isPrimary"=false,"updatedAt"=NOW()
           WHERE "accountId"=$1 AND "type"='EMAIL'`,
          id,
        );
        const current = await tx.$queryRawUnsafe<Array<{ id: string }>>(
          `SELECT "id" FROM "AccountContact"
           WHERE "accountId"=$1 AND "type"='EMAIL' AND LOWER("value")=LOWER($2) LIMIT 1`,
          id,
          previousEmail || email,
        );
        if (current.length) {
          await tx.$executeRawUnsafe(
            'UPDATE "AccountContact" SET "value"=$1,"isPrimary"=true,"updatedAt"=NOW() WHERE "id"=$2',
            email,
            current[0].id,
          );
        } else {
          await tx.$executeRawUnsafe(
            `INSERT INTO "AccountContact" ("id","accountId","type","value","isPrimary","createdAt","updatedAt")
             VALUES ($1,$2,'EMAIL',$3,true,NOW(),NOW())`,
            randomBytes(18).toString('hex'),
            id,
            email,
          );
        }
      }
      await tx.$executeRawUnsafe('UPDATE "EmailVerificationTicket" SET "usedAt"=NOW() WHERE "id"=$1', ticket.id);
      const ownerField = kind === 'PLATFORM' ? 'platformAccountId' : 'accountId';
      await tx.$executeRawUnsafe(
        `UPDATE "EmailVerificationTicket" SET "usedAt"=NOW()
         WHERE "subjectKind"=$1 AND "${ownerField}"=$2 AND "usedAt" IS NULL`,
        kind,
        id,
      );
    });

    return { verified: true, email };
  }
}
