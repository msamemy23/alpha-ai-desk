// Gmail SMTP email helper using nodemailer
import nodemailer from 'nodemailer';

// Create reusable transporter
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER || 'msamemy23@gmail.com',
    pass: process.env.GMAIL_APP_PASSWORD, // App-specific password
  },
});

export async function sendEmail({
  to,
  subject,
  html,
  from,
  replyTo,
}: {
  to: string;
  subject: string;
  html: string;
  from?: string;
  replyTo?: string;
}): Promise<void> {
  try {
    await transporter.sendMail({
      from: from || `"Alpha International Auto Center" <${process.env.GMAIL_USER || 'msamemy23@gmail.com'}>`,
      to,
      subject,
      html,
      replyTo: replyTo || process.env.GMAIL_USER || 'msamemy23@gmail.com',
    });
    console.log('Email sent successfully to:', to);
  } catch (error) {
    console.error('Failed to send email:', error);
    throw error;
  }
}
