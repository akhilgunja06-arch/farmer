import nodemailer, { type Transporter } from 'nodemailer';
import { config, capabilities } from '../config.js';

let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (!capabilities.email) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.mail.host,
      port: config.mail.port,
      secure: config.mail.secure,
      auth: config.mail.user ? { user: config.mail.user, pass: config.mail.password } : undefined,
    });
  }
  return transporter;
}

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/**
 * Send a transactional email, or log it when SMTP is not configured.
 *
 * The fallback is the important part: with no mail provider the verification
 * and reset flows still work end to end, because the link is written to the
 * server log with a clear marker. Nothing is silently swallowed and the UI is
 * never told an email was sent when it was not.
 */
export async function sendMail(message: MailMessage): Promise<{ sent: boolean; reason?: string }> {
  const transport = getTransporter();

  if (!transport) {
    console.log(
      [
        '',
        '[EMAIL:DISABLED] SMTP is not configured, so this message was not sent.',
        'Configure SMTP_HOST / SMTP_USER / SMTP_PASSWORD to deliver it.',
        `  To:      ${message.to}`,
        `  Subject: ${message.subject}`,
        '  Body:',
        message.text
          .split('\n')
          .map((line) => `    ${line}`)
          .join('\n'),
        '',
      ].join('\n'),
    );
    return { sent: false, reason: 'not_configured' };
  }

  try {
    await transport.sendMail({
      from: config.mail.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
    return { sent: true };
  } catch (err) {
    // A mail failure must not fail the request that triggered it. The account
    // operation already succeeded; the operator sees the error in the log.
    console.error('[email] delivery failed:', (err as Error).message);
    return { sent: false, reason: 'delivery_failed' };
  }
}

const shell = (title: string, bodyHtml: string): string => `
<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f7f5ef;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#2b2b26;">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px;padding:32px;border:1px solid #e6e1d5;">
      <h1 style="margin:0 0 8px;font-size:22px;color:#1f6b3a;">RythuDirect</h1>
      <p style="margin:0 0 24px;font-size:13px;color:#6b6b60;">${title}</p>
      ${bodyHtml}
      <hr style="border:none;border-top:1px solid #eee9dd;margin:28px 0 16px;" />
      <p style="margin:0;font-size:12px;color:#8a8a7d;">
        You received this because someone used this address on RythuDirect.
        If that was not you, you can ignore this message.
      </p>
    </div>
  </body>
</html>`;

export async function sendVerificationEmail(to: string, rawToken: string, fullName: string) {
  const link = `${config.appUrl}/auth/verify-email?token=${encodeURIComponent(rawToken)}`;
  return sendMail({
    to,
    subject: 'Confirm your RythuDirect email address',
    text: [
      `Hello ${fullName},`,
      '',
      'Confirm your email address to activate your RythuDirect account:',
      link,
      '',
      'This link expires in 24 hours.',
      '',
      'If you did not create an account, no action is needed.',
    ].join('\n'),
    html: shell(
      'Confirm your email address',
      `<p style="margin:0 0 20px;font-size:15px;line-height:1.6;">Hello ${escapeHtml(fullName)},</p>
       <p style="margin:0 0 24px;font-size:15px;line-height:1.6;">
         Confirm your email address to activate your RythuDirect account.
       </p>
       <a href="${link}" style="display:inline-block;background:#1f6b3a;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:10px;font-size:15px;font-weight:600;">Confirm email</a>
       <p style="margin:24px 0 0;font-size:13px;color:#6b6b60;">This link expires in 24 hours.</p>`,
    ),
  });
}

export async function sendPasswordResetEmail(to: string, rawToken: string, fullName: string) {
  const link = `${config.appUrl}/auth/reset-password?token=${encodeURIComponent(rawToken)}`;
  return sendMail({
    to,
    subject: 'Reset your RythuDirect password',
    text: [
      `Hello ${fullName},`,
      '',
      'Use this link to choose a new password:',
      link,
      '',
      'This link expires in 1 hour and can be used once.',
      '',
      'If you did not request a password reset, ignore this email — your',
      'current password will keep working.',
    ].join('\n'),
    html: shell(
      'Reset your password',
      `<p style="margin:0 0 20px;font-size:15px;line-height:1.6;">Hello ${escapeHtml(fullName)},</p>
       <p style="margin:0 0 24px;font-size:15px;line-height:1.6;">
         Use the button below to choose a new password.
       </p>
       <a href="${link}" style="display:inline-block;background:#1f6b3a;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:10px;font-size:15px;font-weight:600;">Choose a new password</a>
       <p style="margin:24px 0 0;font-size:13px;color:#6b6b60;">
         This link expires in 1 hour and can be used once. If you did not request
         a reset, ignore this email — your current password keeps working.
       </p>`,
    ),
  });
}

export async function sendOrderPlacedEmail(
  to: string, orderNumber: string, total: string, farmerName: string,
) {
  return sendMail({
    to,
    subject: `Order ${orderNumber} placed on RythuDirect`,
    text: [
      `Your order ${orderNumber} has been placed.`,
      `Seller: ${farmerName}`,
      `Total: ${total}`,
      '',
      `Track it at ${config.appUrl}/customer/orders`,
    ].join('\n'),
  });
}

export async function sendNewOrderEmailToFarmer(
  to: string, orderNumber: string, total: string,
) {
  return sendMail({
    to,
    subject: `New order ${orderNumber} received`,
    text: [
      `You have a new order: ${orderNumber}`,
      `Order value: ${total}`,
      '',
      `Review and accept it at ${config.appUrl}/farmer/orders`,
    ].join('\n'),
  });
}

export async function sendOrderStatusEmail(
  to: string, orderNumber: string, status: string,
) {
  const readable = status.replace(/_/g, ' ');
  return sendMail({
    to,
    subject: `Order ${orderNumber} is now ${readable}`,
    text: [
      `Order ${orderNumber} status changed to: ${readable}`,
      '',
      `See the details at ${config.appUrl}/customer/orders`,
    ].join('\n'),
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
