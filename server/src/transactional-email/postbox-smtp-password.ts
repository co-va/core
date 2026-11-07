import { createHmac } from 'node:crypto';

/** Cloud Postbox static access keys require a derived SMTP password. */
export function postboxSmtpPassword(keyId: string, keySecret: string): string {
  // Postbox API-key credentials already use the secret as the SMTP password.
  if (!keyId.startsWith('YCA')) return keySecret;

  // Cloud Postbox's documented signature chain for static access keys.
  let signature: Uint8Array = Buffer.from(`AWS4${keySecret}`, 'utf8');
  for (const part of ['20230926', 'ru-central1', 'postbox', 'aws4_request', 'SendRawEmail']) {
    signature = createHmac('sha256', signature).update(part, 'utf8').digest();
  }
  return Buffer.concat([Buffer.from([0x04]), signature]).toString('base64');
}
