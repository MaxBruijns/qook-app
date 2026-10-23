export const mailReady = (env) => !!(env.RESEND_API_KEY && env.MAIL_FROM);
export class MailError extends Error {
}
export async function sendMail(env, to, subject, text, opts = {}) {
    const headers = {};
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
