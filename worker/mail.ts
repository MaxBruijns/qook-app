/**
 * E-mail versturen via Resend. Werkt pas als RESEND_API_KEY en MAIL_FROM zijn ingesteld
 * (Resend vereist een eigen domein). Zonder die instellingen wordt er niets verstuurd.
 */
export interface MailEnv { RESEND_API_KEY?: string; MAIL_FROM?: string }

export const mailReady = (env: MailEnv) => !!(env.RESEND_API_KEY && env.MAIL_FROM);

export class MailError extends Error {}

export async function sendMail(env: MailEnv, to: string, subject: string, text: string,
                               opts: { html?: string; unsubscribeUrl?: string } = {}) {
  const headers: Record<string, string> = {};
  if (opts.unsubscribeUrl) {
    headers['List-Unsubscribe'] = `<${opts.unsubscribeUrl}>`;
    headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: env.MAIL_FROM, to: [to], subject, text, ...(opts.html ? { html: opts.html } : {}),
      ...(Object.keys(headers).length ? { headers } : {}) }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    console.error('Mail versturen mislukt', res.status, (await res.text()).slice(0, 300));
    throw new MailError('De e-mail kon niet verstuurd worden. Probeer het later opnieuw.');
  }
}
