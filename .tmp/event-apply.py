from pathlib import Path
import re

def rd(p): return Path(p).read_text()
def wr(p,s): Path(p).write_text(s)
def rep(p,a,b):
    s=rd(p)
    if a not in s: raise SystemExit(f'missing {p}: {a[:80]}')
    wr(p,s.replace(a,b))

# Prisma canonical Event.
rep('server/prisma/schema.prisma','  records                  Record[]\n  recordEvents             RecordEvent[]\n  businessOperationalState BusinessOperationalState?','  records                  Record[]\n  recordEvents             RecordEvent[]\n  events                   Event[]\n  businessOperationalState BusinessOperationalState?')
rep('server/prisma/schema.prisma','model BusinessOperationalState {','model Event {\n  id          String   @id\n  tenantId    String?\n  ownerType   String\n  ownerId     String\n  context     Json     @default("{}")\n  date        String\n  from        String\n  to          String\n  title       String\n  description String   @default("")\n  color       String   @default("#777A7D")\n  workplaceId String   @default("")\n  createdAt   DateTime @default(now())\n  updatedAt   DateTime @updatedAt\n\n  tenant Tenant? @relation(fields: [tenantId], references: [id], onDelete: Cascade)\n\n  @@index([tenantId, workplaceId, date])\n  @@index([ownerType, ownerId, date])\n}\n\nmodel BusinessOperationalState {')

# Server module + no runtime Break dataset.
rep('server/src/app.module.ts',"import { AccountUnreadModule } from './account-unread/account-unread.module';","import { AccountUnreadModule } from './account-unread/account-unread.module';\nimport { EventModule } from './event/event.module';")
rep('server/src/app.module.ts','    AccountUnreadModule,\n  ],','    AccountUnreadModule,\n    EventModule,\n  ],')
s=rd('server/src/business-state/business-state.service.ts')
s=re.sub(r'\n\s*breaks:\s*JsonObject\[\];','',s)
s=s.replace("'days', 'breaks', 'procedures'","'days', 'procedures'")
s=re.sub(r'\n\s*breaks:\s*arrayObjects\(source\.breaks\),','',s)
wr('server/src/business-state/business-state.service.ts',s)

# Server-backed client Event queue.
rep('core/business-persistence.js',"  if (value.startsWith('/business-state/operational')) return 'operational';","  if (value.startsWith('/events')) return 'business';\n  if (value.startsWith('/business-state/operational')) return 'operational';")
rep('core/business-persistence.js',"export function queueRecordEventUpsert(event, position = 0) {","export function queueEventUpsert(event) {\n  const id = String(event?.id || '').trim();\n  if (!id) return Promise.resolve();\n  return enqueue(`/events/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ event }) }, 'Не удалось сохранить событие на сервере');\n}\n\nexport function queueEventDelete(id) {\n  const eventId = String(id || '').trim();\n  if (!eventId) return Promise.resolve();\n  return enqueue(`/events/${encodeURIComponent(eventId)}`, { method: 'DELETE' }, 'Не удалось удалить событие на сервере');\n}\n\nexport function queueRecordEventUpsert(event, position = 0) {")

wr('core/runtime/business-state.js',"""import { apiRequest } from '../auth.js';
import { setBusinessServerReady } from '../business-persistence.js';
import { hydrateUEIFromServer } from '../uei.js';
import { hydrateRecordStateFromServer } from '../record/index.js';
import { hydrateEventsFromServer } from '../event/index.js';
import { hydratePeopleFromServer } from '../people/data.js';
import { loadAllDeposits } from '../loyalty/deposit/data.js';
function clone(value){return value==null?value:JSON.parse(JSON.stringify(value));}
function normalizeUEI(value={}){return {entities:value?.entities&&typeof value.entities==='object'&&!Array.isArray(value.entities)?clone(value.entities):{},relations:value?.relations&&typeof value.relations==='object'&&!Array.isArray(value.relations)?clone(value.relations):{},revoked:Array.isArray(value?.revoked)?clone(value.revoked):[]};}
async function payload(response,fallback){const value=await response.json().catch(()=>({}));if(!response.ok)throw new Error(value?.message||fallback);return value;}
export async function loadBusinessState(){setBusinessServerReady(false);const [remote,events]=await Promise.all([payload(await apiRequest('/business-state'),'Не удалось загрузить People, UEI и Записи'),payload(await apiRequest('/events'),'Не удалось загрузить события'),loadAllDeposits()]);hydratePeopleFromServer(Array.isArray(remote.people)?clone(remote.people):[]);hydrateUEIFromServer(normalizeUEI(remote.uei));hydrateRecordStateFromServer({records:Array.isArray(remote.records)?clone(remote.records):[],recordEvents:Array.isArray(remote.recordEvents)?clone(remote.recordEvents):[]});hydrateEventsFromServer(Array.isArray(events)?clone(events):[]);setBusinessServerReady(true);}
""")
wr('core/runtime/operational-state.js',"""import { apiRequest } from '../auth.js';
import { hydrateDaysFromServer } from '../day/index.js';
import { hydrateProceduresFromServer } from '../../core/service/procedures/data.js';
import { hydrateBookingSettingsFromServer } from '../booking-settings/index.js';
function clone(value){return value==null?value:JSON.parse(JSON.stringify(value));}
async function payload(response,fallback){const value=await response.json().catch(()=>({}));if(!response.ok)throw new Error(value?.message||fallback);return value;}
export async function loadOperationalState(){const remote=await payload(await apiRequest('/business-state/operational'),'Не удалось загрузить График, процедуры и настройки онлайн-записи');hydrateDaysFromServer(Array.isArray(remote.days)?clone(remote.days):[]);hydrateProceduresFromServer({procedures:Array.isArray(remote.procedures)?clone(remote.procedures):[],procedureHistory:Array.isArray(remote.procedureHistory)?clone(remote.procedureHistory):[]});hydrateBookingSettingsFromServer(remote.bookingSettings&&typeof remote.bookingSettings==='object'&&!Array.isArray(remote.bookingSettings)?clone(remote.bookingSettings):null);}
""")

# Timeline: Event plaque, not Break.
p='ui/time/journal-day.js'; s=rd(p)
old='''function usageMarkup(usage, { interactive = true } = {}) {\n  if (usage?.type === 'record') return recordMarkup(usage, { interactive });\n  return interactive\n    ? `<button type="button" class="journal-record journal-record--break" data-journal-usage="${escape(usage.sourceId || usage.id)}"><strong>Перерыв</strong></button>`\n    : '<div class="journal-record journal-record--break" aria-disabled="true"><strong>Перерыв</strong></div>';\n}'''
new='''function usageMarkup(usage, { interactive = true } = {}) {\n  if (usage?.type === 'record') return recordMarkup(usage, { interactive });\n  const title = escape(usage?.title || 'Событие');\n  const period = `${escape(usage?.from || '')}–${escape(usage?.to || '')}`;\n  const color = /^#[0-9A-Fa-f]{6}$/.test(String(usage?.color || '')) ? String(usage.color) : '#777A7D';\n  const content = `<span class="journal-event__time">${period}</span><strong class="journal-event__title">${title}</strong>`;\n  return interactive\n    ? `<button type="button" class="journal-record journal-record--event" style="--journal-event-color:${escape(color)}" data-journal-usage="${escape(usage.sourceId || usage.id)}">${content}</button>`\n    : `<div class="journal-record journal-record--event" style="--journal-event-color:${escape(color)}" aria-disabled="true">${content}</div>`;\n}'''
if old not in s: raise SystemExit('timeline old markup missing')
wr(p,s.replace(old,new))
with open('ui/time/time.css','a') as f: f.write('\n.journal-record--event{border-left:4px solid var(--journal-event-color,#777A7D);background:color-mix(in srgb,var(--journal-event-color,#777A7D) 16%,#fff);display:flex;flex-direction:column;align-items:flex-start;gap:2px}\n.journal-event__time{font-size:.78em;opacity:.75}\n.journal-event__title{font-weight:700}\n')
rep('core/time/usage.js','// This module does not own WorkPlan, Record, Break, Availability, or UI state.','// This module does not own WorkPlan, Record, Event, Availability, or UI state.')

# Shared owner no longer carries Break step labels.
p='ui/record/creation-flow.js'; s=rd(p); s=re.sub(r"\n\s*'break-start': 'Выбор времени С',\n\s*'break-end': 'Выбор времени До',\n\s*'break-confirmation': 'Подтверждение перерыва',",'',s); wr(p,s)

# Existing architecture guards/tests follow the new ownership.
p='scripts/check-record-creation-architecture.mjs'; s=rd(p)
s=s.replace("const breakCreation = read('journal/break-create.js');","const eventCreation = read('journal/event-create.js');")
s=s.replace("expect(journalCreation.includes(\"label: 'Занять время'\"), 'Journal creation shell must own the Break mode label.');","expect(journalCreation.includes(\"label: 'Событие'\"), 'Journal creation shell must own the Event mode label.');")
s=s.replace("expect(!records.includes('createJournalBreak'), 'Records must not create Break.');","expect(!records.includes('createJournalBreak') && !records.includes('createEvent'), 'Records must not create Break or Event.');")
s=s.replace("expect(breakCreation.includes('createJournalBreak'), 'Break creation must live in the Journal Break flow.');\nexpect(breakCreation.includes('timeHint'), 'Break flow must receive the original Timeline time hint.');","expect(eventCreation.includes('createEvent'), 'Event creation must live in the Event flow.');\nexpect(eventCreation.includes('timeHint'), 'Event flow must receive the original Timeline time hint.');")
wr(p,s)

p='scripts/check-time-ui-ownership.mjs'; s=rd(p)
s=s.replace("const breakCreation = read('journal/break-create.js');\nconst breakView = read('journal/break-view.js');\nconst breakData = read('journal/break-data.js');\nconst breakRead = read('journal/break-read.js');\nconst breakService = read('journal/break-service.js');","const eventCreation = read('journal/event-create.js');\nconst eventView = read('journal/event-view.js');\nconst eventData = read('core/event/data.js');\nconst eventRead = read('core/event/read.js');\nconst eventService = read('core/event/service.js');")
start=s.index("if (!/from ['\"]\\.\\.\\/core\\/time\\/index\\.js['\"]/.test(breakCreation))")
end=s.index("\nif (!/getTimeUsagesForScope/.test(journalDay)",start)
event_checks="""if (!/from ['\"]\\.\\.\\/core\\/time\\/index\\.js['\"]/.test(eventCreation)) fail('journal/event-create.js', 'Event creation must ask Core Availability.');
if (!/checkTimeAvailability/.test(eventCreation) || !/openTimeRangeAction/.test(eventCreation)) fail('journal/event-create.js', 'Event creation must use canonical Availability and shared Time UI.');
if (!/checkTimeAvailability/.test(eventView) || !/excludeId: eventId/.test(eventView)) fail('journal/event-view.js', 'Event View edits must use canonical Availability with excludeId.');
if (!/queueEventUpsert/.test(eventData) || !/queueEventDelete/.test(eventData)) fail('core/event/data.js', 'Event data must use server-backed persistence.');
if (!/getEventsForDay/.test(eventRead)) fail('core/event/read.js', 'Event read model must own day projection.');
if (!/createEvent/.test(eventService) || !/updateEvent/.test(eventService) || !/removeEvent/.test(eventService)) fail('core/event/service.js', 'Event service must own Event commands.');
"""
s=s[:start]+event_checks+s[end:]
s=s.replace("if (/break-service|createJournalBreak|listAvailableEndTimes/.test(recordFlow)) fail('core/records/records.js', 'Records must not own Break availability or commands.');","if (/break-service|createJournalBreak|createEvent|removeEvent|updateEvent/.test(recordFlow)) fail('core/records/records.js', 'Records must not own Event/Break commands.');")
wr(p,s)

for p in ['tests/record-creation-x-flow.test.mjs','tests/time-ui-ownership.test.mjs']:
    s=rd(p).replace('journal/break-create.js','journal/event-create.js').replace('journal/break-view.js','journal/event-view.js').replace('createJournalBreak','createEvent').replace('Занять время','Событие').replace('Break creation','Event creation').replace('Break flow','Event flow').replace('Break view','Event view')
    wr(p,s)

p='package.json'; s=rd(p); s=s.replace('node tests/document-lifecycle-architecture.test.mjs"','node tests/document-lifecycle-architecture.test.mjs && node tests/event-domain-architecture.test.mjs"'); wr(p,s)

for p in ['journal/break-data.js','journal/break-read.js','journal/break-service.js','journal/break-view.js','journal/break-create.js']:
    q=Path(p)
    if q.exists(): q.unlink()
