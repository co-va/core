import { BadRequestException, ConflictException, HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { BusinessStateService } from '../business-state/business-state.service';
import { ConsentPolicyService } from '../tenant-document-archive/consent-policy.service';
import { PrismaService } from '../prisma.service';
import { CommunicationDispatchService } from './communication-dispatch.service';
import { SaasAccessService } from '../saas-access/saas-access.service';

type TemplateRow = { id: string; tenantId: string; name: string; body: string; createdAt: Date; updatedAt: Date };
type GroupRow = { id: string; tenantId: string; name: string; createdAt: Date; updatedAt: Date };
type GroupMemberRow = { groupId: string; tenantId: string; personKey: string; createdAt: Date };
function text(value: unknown) { return String(value ?? '').trim(); }
function objectValue(value: unknown): Record<string, any> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {}; }
function canonicalPhone(value: unknown) {
  const digits = text(value).replace(/\D/g, '');
  if (digits.length === 10) return `7${digits}`;
  if (digits.length === 11 && digits.startsWith('8')) return `7${digits.slice(1)}`;
  return digits;
}
function canonicalEmail(value: unknown) {
  const email = text(value).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

@Injectable()
export class CommunicationBroadcastService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly businessState: BusinessStateService,
    private readonly documents: ConsentPolicyService,
    private readonly dispatch: CommunicationDispatchService,
    private readonly access: SaasAccessService,
  ) {}

  private normalizeChannel(value: unknown) {
    const channel = text(value).toUpperCase();
    if (!['TELEGRAM', 'EMAIL', 'SMS', 'WHATSAPP'].includes(channel)) throw new BadRequestException('Не выбран канал рассылки');
    return channel;
  }

  private renderTemplate(body: string, person: { name: string; surname: string; phone: string; email: string; code: string }) {
    return body
      .replaceAll('{{person.name}}', person.name)
      .replaceAll('{{person.surname}}', person.surname)
      .replaceAll('{{person.phone}}', person.phone)
      .replaceAll('{{person.email}}', person.email)
      .replaceAll('{{person.code}}', person.code);
  }

  async listTemplates(tenantId: string) {
    return this.prisma.$queryRaw<TemplateRow[]>`
      SELECT "id", "tenantId", "name", "body", "createdAt", "updatedAt"
      FROM "CommunicationTemplate" WHERE "tenantId" = ${tenantId}
      ORDER BY "updatedAt" DESC, "name" ASC
    `;
  }

  async saveTemplate(tenantId: string, input: { id?: unknown; name?: unknown; body?: unknown }) {
    const id = text(input?.id); const name = text(input?.name); const body = text(input?.body);
    if (!name) throw new BadRequestException('Введите название шаблона');
    if (!body) throw new BadRequestException('Введите текст шаблона');
    if (id) {
      const updated = await this.prisma.$executeRaw`
        UPDATE "CommunicationTemplate" SET "name" = ${name}, "body" = ${body}, "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = ${id} AND "tenantId" = ${tenantId}
      `;
      if (!updated) throw new NotFoundException('Шаблон не найден');
      const rows = await this.prisma.$queryRaw<TemplateRow[]>`
        SELECT "id", "tenantId", "name", "body", "createdAt", "updatedAt"
        FROM "CommunicationTemplate" WHERE "id" = ${id} AND "tenantId" = ${tenantId} LIMIT 1
      `;
      return rows[0];
    }
    const templateId = randomUUID();
    await this.prisma.$executeRaw`
      INSERT INTO "CommunicationTemplate" ("id", "tenantId", "name", "body", "createdAt", "updatedAt")
      VALUES (${templateId}, ${tenantId}, ${name}, ${body}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `;
    const rows = await this.prisma.$queryRaw<TemplateRow[]>`
      SELECT "id", "tenantId", "name", "body", "createdAt", "updatedAt"
      FROM "CommunicationTemplate" WHERE "id" = ${templateId} AND "tenantId" = ${tenantId} LIMIT 1
    `;
    return rows[0];
  }

  async deleteTemplate(tenantId: string, idValue: unknown) {
    const id = text(idValue); if (!id) throw new BadRequestException('Не указан шаблон');
    const deleted = await this.prisma.$executeRaw`DELETE FROM "CommunicationTemplate" WHERE "id" = ${id} AND "tenantId" = ${tenantId}`;
    if (!deleted) throw new NotFoundException('Шаблон не найден');
    return { deleted: true, id };
  }

  async listGroups(tenantId: string) {
    const groups = await this.prisma.$queryRaw<GroupRow[]>`
      SELECT "id", "tenantId", "name", "createdAt", "updatedAt"
      FROM "CommunicationGroup" WHERE "tenantId" = ${tenantId}
      ORDER BY "name" ASC, "updatedAt" DESC
    `;
    if (!groups.length) return [];
    const members = await this.prisma.$queryRaw<GroupMemberRow[]>`
      SELECT "groupId", "tenantId", "personKey", "createdAt"
      FROM "CommunicationGroupMember" WHERE "tenantId" = ${tenantId}
      ORDER BY "createdAt" ASC
    `;
    const byGroup = new Map<string, string[]>();
    for (const member of members) {
      const current = byGroup.get(member.groupId) || [];
      current.push(member.personKey);
      byGroup.set(member.groupId, current);
    }
    return groups.map((group) => ({ ...group, personKeys: byGroup.get(group.id) || [] }));
  }

  private async knownPersonKeys(tenantId: string) {
    const business = await this.businessState.get(tenantId);
    return new Set((Array.isArray(business.people) ? business.people : []).map((value) => text(objectValue(value).key)).filter(Boolean));
  }

  async saveGroup(tenantId: string, input: { id?: unknown; name?: unknown; personKeys?: unknown }) {
    const id = text(input?.id);
    const name = text(input?.name);
    if (!name) throw new BadRequestException('Введите название группы');
    const known = await this.knownPersonKeys(tenantId);
    const personKeys = [...new Set((Array.isArray(input?.personKeys) ? input.personKeys : []).map(text).filter((key) => key && known.has(key)))];
    if (!personKeys.length) throw new BadRequestException('Выберите хотя бы одного человека');
    const groupId = id || randomUUID();
    try {
      await this.prisma.$transaction(async (tx) => {
        if (id) {
          const updated = await tx.$executeRaw`
            UPDATE "CommunicationGroup" SET "name" = ${name}, "updatedAt" = CURRENT_TIMESTAMP
            WHERE "id" = ${id} AND "tenantId" = ${tenantId}
          `;
          if (!updated) throw new NotFoundException('Группа не найдена');
        } else {
          await tx.$executeRaw`
            INSERT INTO "CommunicationGroup" ("id", "tenantId", "name", "createdAt", "updatedAt")
            VALUES (${groupId}, ${tenantId}, ${name}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          `;
        }
        await tx.$executeRaw`DELETE FROM "CommunicationGroupMember" WHERE "groupId" = ${groupId} AND "tenantId" = ${tenantId}`;
        for (const personKey of personKeys) {
          await tx.$executeRaw`
            INSERT INTO "CommunicationGroupMember" ("groupId", "tenantId", "personKey", "createdAt")
            VALUES (${groupId}, ${tenantId}, ${personKey}, CURRENT_TIMESTAMP)
            ON CONFLICT ("groupId", "personKey") DO NOTHING
          `;
        }
      });
    } catch (error: any) {
      if (String(error?.code || '') === 'P2010' || /unique|duplicate/i.test(String(error?.message || ''))) {
        throw new ConflictException('Группа с таким названием уже существует');
      }
      throw error;
    }
    const groups = await this.listGroups(tenantId);
    return groups.find((group) => group.id === groupId) || null;
  }

  async deleteGroup(tenantId: string, idValue: unknown) {
    const id = text(idValue); if (!id) throw new BadRequestException('Не указана группа');
    const deleted = await this.prisma.$executeRaw`DELETE FROM "CommunicationGroup" WHERE "id" = ${id} AND "tenantId" = ${tenantId}`;
    if (!deleted) throw new NotFoundException('Группа не найдена');
    return { deleted: true, id };
  }

  private async groupPersonKeys(tenantId: string, groupIdValue: unknown) {
    const groupId = text(groupIdValue);
    if (!groupId) return [];
    const rows = await this.prisma.$queryRaw<Array<{ personKey: string }>>`
      SELECT "personKey" FROM "CommunicationGroupMember"
      WHERE "tenantId" = ${tenantId} AND "groupId" = ${groupId}
      ORDER BY "createdAt" ASC
    `;
    return rows.map((row) => text(row.personKey)).filter(Boolean);
  }

  private async people(tenantId: string) {
    const business = await this.businessState.get(tenantId);
    const identity = business.uei || { entities: {}, relations: {} };
    return (Array.isArray(business.people) ? business.people : [])
      .map((value) => objectValue(value))
      .map((person) => {
        const personKey = text(person.key);
        const uei = text(identity.relations?.[`person:${personKey}`] || person.uei);
        return {
          personKey,
          uei,
          code: uei,
          name: text(person.name), surname: text(person.surname),
          phone: (Array.isArray(person.phones) ? person.phones : []).map(canonicalPhone).find(Boolean) || '',
          email: (Array.isArray(person.emails) ? person.emails : []).map(canonicalEmail).find(Boolean) || '',
        };
      }).filter((person) => person.personKey && person.phone);
  }

  private async requestedPeople(tenantId: string, people: Awaited<ReturnType<CommunicationBroadcastService['people']>>, input: { all?: unknown; phones?: unknown; personKeys?: unknown; groupId?: unknown }) {
    const all = input?.all === true;
    const phones = [...new Set((Array.isArray(input?.phones) ? input.phones : []).map(canonicalPhone).filter(Boolean))];
    const explicitKeys = [...new Set((Array.isArray(input?.personKeys) ? input.personKeys : []).map(text).filter(Boolean))];
    const groupKeys = await this.groupPersonKeys(tenantId, input?.groupId);
    const personKeys = [...new Set([...explicitKeys, ...groupKeys])];
    if (!all && !phones.length && !personKeys.length) throw new BadRequestException('Выберите людей, группу или явно укажите «все человекы»');

    if (all) return [...people];
    const selected = people.filter((person) => personKeys.includes(person.personKey) || phones.includes(person.phone));
    const seen = new Set<string>();
    return selected.filter((person) => {
      const key = person.personKey || `${person.uei}|${person.phone}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private async channelDestination(_tenantId: string, channel: string, person: { phone: string; uei: string; email: string }) {
    if (channel === 'TELEGRAM') return '';
    if (channel === 'EMAIL') return canonicalEmail(person.email);
    return '';
  }

  async preview(tenantId: string, input: { channel?: unknown; all?: unknown; phones?: unknown; personKeys?: unknown; groupId?: unknown }) {
    const channel = this.normalizeChannel(input?.channel);
    const allPeople = await this.people(tenantId);
    const requested = await this.requestedPeople(tenantId, allPeople, input || {});
    const audience: Array<(typeof requested)[number]> = [];
    const excluded: Array<{ personKey: string; phone: string; reason: string }> = [];
    for (const person of requested) {
      const destination = await this.channelDestination(tenantId, channel, person);
      if (!destination) { excluded.push({ personKey: person.personKey, phone: person.phone, reason: 'no-channel' }); continue; }
      if (!(await this.documents.canSendMarketing(tenantId, channel, destination))) {
        excluded.push({ personKey: person.personKey, phone: person.phone, reason: 'no-marketing-consent' });
        continue;
      }
      audience.push(person);
    }
    return { channel, requestedCount: requested.length, eligibleCount: audience.length, excludedCount: excluded.length, audience, excluded };
  }

  private async ensureRateLimit(tenantId: string, nextCount: number) {
    const since = new Date(Date.now() - 60_000);
    const rows = await this.prisma.$queryRaw<Array<{ count: number }>>`
      SELECT COALESCE(SUM("sentCount"), 0)::int AS "count" FROM "CommunicationBroadcastRun"
      WHERE "tenantId" = ${tenantId} AND "createdAt" >= ${since}
    `;
    const used = Number(rows[0]?.count || 0);
    const limit = Math.max(1, Number(process.env.BROADCAST_MAX_PER_MINUTE || 100));
    if (used + nextCount > limit) throw new HttpException(`Лимит рассылки: не более ${limit} сообщений в минуту`, HttpStatus.TOO_MANY_REQUESTS);
  }

  async send(tenantId: string, input: { channel?: unknown; all?: unknown; phones?: unknown; personKeys?: unknown; groupId?: unknown; name?: unknown; body?: unknown }) {
    await this.access.assertRealOperationsAllowed(tenantId);
    const name = text(input?.name) || 'Сообщение'; const body = text(input?.body);
    if (!body) throw new BadRequestException('Введите текст сообщения');
    const preview = await this.preview(tenantId, input || {});
    if (!preview.eligibleCount) throw new BadRequestException('Нет людей, которым можно отправить сообщение');
    if (!['TELEGRAM', 'EMAIL'].includes(preview.channel)) throw new BadRequestException(`Транспорт ${preview.channel} пока не подключён к массовой отправке`);
    await this.ensureRateLimit(tenantId, preview.eligibleCount);
    const runId = randomUUID();
    await this.prisma.$executeRaw`
      INSERT INTO "CommunicationBroadcastRun" ("id", "tenantId", "channel", "name", "body", "requestedCount", "eligibleCount", "sentCount", "failedCount", "status", "createdAt")
      VALUES (${runId}, ${tenantId}, ${preview.channel}, ${name}, ${body}, ${preview.requestedCount}, ${preview.eligibleCount}, 0, 0, 'sending', CURRENT_TIMESTAMP)
    `;
    let sentCount = 0; let failedCount = 0; const failures: Array<{ personKey: string; phone: string; error: string }> = [];
    for (const recipient of preview.audience) {
      try {
        const renderedBody = this.renderTemplate(body, recipient);
        await this.dispatch.send(tenantId, { phone: recipient.phone, uei: recipient.uei, channel: preview.channel, subject: name, body: renderedBody, purpose: 'MARKETING' });
        sentCount += 1;
      } catch (error) {
        failedCount += 1;
        failures.push({ personKey: recipient.personKey, phone: recipient.phone, error: error instanceof Error ? error.message : String(error) });
      }
    }
    const status = failedCount ? (sentCount ? 'partial' : 'failed') : 'sent';
    await this.prisma.$executeRaw`
      UPDATE "CommunicationBroadcastRun" SET "sentCount" = ${sentCount}, "failedCount" = ${failedCount}, "status" = ${status}, "finishedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${runId} AND "tenantId" = ${tenantId}
    `;
    return { runId, name, status, ...preview, sentCount, failedCount, failures };
  }
}
