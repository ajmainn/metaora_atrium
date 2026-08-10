import nodemailer from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';

export type MailMessage = {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
};

export type MailSender = (message: MailMessage) => Promise<void>;

let transporter: nodemailer.Transporter<SMTPTransport.SentMessageInfo> | null = null;

function getTransporter() {
  if (!transporter) {
    const user = process.env.SMTP_USER || '';
    const pass = process.env.SMTP_PASSWORD || '';

    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'localhost',
      port: Number(process.env.SMTP_PORT) || 1025,
      secure: false,
      auth: user ? { user, pass } : undefined
    });
  }

  return transporter;
}

export async function sendMail(message: MailMessage): Promise<void> {
  await getTransporter().sendMail({
    from: process.env.SMTP_FROM || process.env.MAIL_FROM || 'atrium@local.test',
    ...message
  });
}

export async function sendMailSafely(message: MailMessage, sender: MailSender = sendMail): Promise<boolean> {
  try {
    await sender(message);
    return true;
  } catch (err) {
    console.error('email send failed', {
      to: message.to,
      subject: message.subject,
      error: err
    });
    return false;
  }
}
