import fs from 'node:fs';

const source = fs.readFileSync('server/src/communication/telegram-bot.service.ts', 'utf8');
const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };

expect(
  !source.includes("offset: -1"),
  'Telegram polling must never collapse a recovered inbound queue to only the latest update.',
);
expect(
  source.includes('offset,')
    && source.includes('limit: 100')
    && source.includes("allowed_updates: ['message']"),
  'Telegram polling must resume from the stored offset and read the pending queue in batches.',
);
expect(
  source.includes('messageTimestampMs')
    && source.includes('row.connectedAt.getTime()')
    && source.includes('if (!predatesConnection) await this.processUpdate(row, update);'),
  'Telegram polling must skip only messages that predate the bot connection while preserving post-connection backlog after recovery.',
);
expect(
  source.includes('SET "inboundOffset" = ${BigInt(nextOffset)}')
    && source.includes('row.inboundOffset = BigInt(nextOffset);'),
  'Telegram polling must persist the next offset after every handled or intentionally skipped update.',
);
expect(
  !source.includes('handleWebhook(')
    && !source.includes("source: 'polling' | 'webhook'")
    && !source.includes('webhookKey'),
  'Polling must be the only inbound Telegram runtime.',
);

if (failures.length) {
  failures.forEach((message) => console.error(`telegram polling recovery: ${message}`));
  process.exit(1);
}
console.log('telegram polling recovery check: OK');
