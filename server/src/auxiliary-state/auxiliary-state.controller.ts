import { BadRequestException, Body, Controller, Get, Param, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { NotificationEventService } from '../notification/notification-event.service';
import { AuxiliaryStateService } from './auxiliary-state.service';

type AuthenticatedRequest = Request & { auth?: { platformAccountId: string; tenantId: string; role: string } };
type AuxiliaryBundle = Record<string, unknown>;
type JsonObject = Record<string, any>;

const READ_SCOPES: Record<string, string[]> = {
  people: ['tags', 'cardAppearanceTemplates'],
  loyalty: ['wallets', 'cardAppearanceTemplates', 'depositPrograms'],
  service: ['products', 'productHistory', 'cardAppearanceTemplates'],
  finance: ['wallets', 'investments', 'loans'],
  tags: ['tags'],
};

function objectValue(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
}

function arrayValue(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown) {
  return String(value ?? '').trim();
}

function scopedBundle(bundle: AuxiliaryBundle, scope: string) {
  const keys = READ_SCOPES[scope];
  if (!keys) throw new BadRequestException('Неизвестный набор связанных данных');
  return Object.fromEntries(keys.map((key) => [key, bundle[key] ?? []]));
}

@Controller('auxiliary-state')
@UseGuards(JwtAuthGuard)
export class AuxiliaryStateController {
  constructor(
    private readonly auxiliaryState: AuxiliaryStateService,
    private readonly notifications: NotificationEventService,
  ) {}

  @Get()
  get(@Req() request: AuthenticatedRequest) {
    return this.auxiliaryState.get(request.auth!.tenantId);
  }

  @Get(':scope')
  async getScope(@Req() request: AuthenticatedRequest, @Param('scope') scope: string) {
    const bundle = await this.auxiliaryState.get(request.auth!.tenantId);
    return scopedBundle(bundle as AuxiliaryBundle, String(scope || '').trim());
  }

  @Put(':dataset')
  async updateDataset(@Req() request: AuthenticatedRequest, @Param('dataset') dataset: string, @Body() body: unknown) {
    const tenantId = request.auth!.tenantId;
    if (String(dataset || '').trim() !== 'investments') {
      return this.auxiliaryState.updateDataset(tenantId, dataset, body);
    }

    const before = await this.auxiliaryState.get(tenantId);
    const result = await this.auxiliaryState.updateDataset(tenantId, dataset, body) as JsonObject;
    const beforeById = new Map(arrayValue(objectValue(before).investments).map((value) => {
      const entity = objectValue(value);
      return [text(entity.id), entity];
    }));

    for (const value of arrayValue(result.investments)) {
      const entity = objectValue(value);
      const id = text(entity.id);
      const terms = objectValue(entity.investmentTerms);
      const participantAccountId = text(terms.participantAccountId);
      if (!id || text(terms.role) !== 'raise' || !participantAccountId || text(terms.participantStatus) !== 'pending') continue;
      const previous = objectValue(beforeById.get(id));
      const previousTerms = objectValue(previous.investmentTerms);
      if (text(previousTerms.participantAccountId) === participantAccountId && text(previousTerms.participantStatus) === 'pending') continue;
      await this.notifications.createEventForPerson(tenantId, { accountId: participantAccountId }, {
        type: 'investment.participation',
        entityType: 'investment',
        entityId: id,
        context: {
          investment: text(entity.name),
          status: 'pending',
          date: new Date().toISOString().slice(0, 10),
        },
      }).catch(() => null);
    }
    return result;
  }
}