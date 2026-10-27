import { BadRequestException, Body, Controller, Get, Param, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuxiliaryStateService } from './auxiliary-state.service';

type AuthenticatedRequest = Request & { auth?: { platformAccountId: string; tenantId: string; role: string } };
type AuxiliaryBundle = Record<string, unknown>;

const READ_SCOPES: Record<string, string[]> = {
  people: ['tags', 'cardAppearanceTemplates'],
  loyalty: ['wallets', 'cardAppearanceTemplates', 'depositPrograms'],
  service: ['products', 'productHistory', 'cardAppearanceTemplates'],
  finance: ['wallets', 'investments', 'loans'],
  tags: ['tags'],
};

function scopedBundle(bundle: AuxiliaryBundle, scope: string) {
  const keys = READ_SCOPES[scope];
  if (!keys) throw new BadRequestException('Неизвестный набор связанных данных');
  return Object.fromEntries(keys.map((key) => [key, bundle[key] ?? []]));
}

@Controller('auxiliary-state')
@UseGuards(JwtAuthGuard)
export class AuxiliaryStateController {
  constructor(private readonly auxiliaryState: AuxiliaryStateService) {}

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
  updateDataset(@Req() request: AuthenticatedRequest, @Param('dataset') dataset: string, @Body() body: unknown) {
    return this.auxiliaryState.updateDataset(request.auth!.tenantId, dataset, body);
  }
}
