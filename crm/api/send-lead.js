/**
 * Vercel Serverless: POST /api/send-lead
 * Recebe envio dos formulários da LP (Hero e Contact), valida e envia para o Railway (SYSTEM_API_URL).
 * Funciona para ambos os forms: hero-form e contact-form.
 */
import nodemailer from 'nodemailer';

function parseBody(req) {
  if (req.body && typeof req.body === 'object' && (req.body.name != null || req.body.email != null)) {
    return req.body;
  }
  if (typeof req.body === 'string' && req.body.length > 0) {
    const params = new URLSearchParams(req.body);
    const o = {};
    for (const [k, v] of params.entries()) o[k] = v;
    return o;
  }
  return {};
}

function csvEscape(s) {
  return `"${String(s).replace(/"/g, '""')}"`;
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=UTF-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const post = parseBody(req);
  const form_name = (post['form-name'] || post.formName || 'contact-form').trim();
  let name = (post.name || '').trim();
  let phone = (post.phone || '').trim();
  let email = (post.email || '').trim();
  let zipcode = (post.zipcode || '').trim();
  let message = (post.message || '').trim();

  const errors = [];
  if (!name || name.length < 2) errors.push('Name is required and must be at least 2 characters');
  if (!phone) errors.push('Phone number is required');
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('Valid email address is required');
  const zipDigits = (zipcode || '').replace(/\D/g, '');
  if (!zipDigits || zipDigits.length < 5) errors.push('Valid 5-digit US zip code is required');
  if (errors.length > 0) {
    return res.status(400).json({ success: false, message: errors.join(', ') });
  }

  zipcode = zipDigits.slice(0, 5);

  let system_sent = false;
  let system_database_saved = false;
  let system_error = '';
  let lead_id = null;
  const systemUrl = (process.env.SYSTEM_API_URL || '').trim().replace(/\/$/, '');

  if (systemUrl) {
    try {
      const url = `${systemUrl}/api/receive-lead`;
      const body = new URLSearchParams({
        'form-name': form_name,
        name,
        phone,
        email,
        zipcode,
        message: message || '',
      }).toString();

      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body,
      });

      if (r.ok) {
        system_sent = true;
        const data = await r.json();
        system_database_saved = data.database_saved === true;
        if (data.lead_id) lead_id = data.lead_id;
      } else {
        const errorText = await r.text();
        system_error = `HTTP ${r.status}: ${errorText.substring(0, 150)}`;
      }
    } catch (e) {
      system_error = e.message || 'Request failed';
    }
  }

  let csv_saved = false;
  try {
    const fs = await import('fs');
    const path = await import('path');
    const csvDir = '/tmp';
    const csvPath = path.join(csvDir, 'leads.csv');
    const csvLine = [new Date().toISOString().slice(0, 19).replace('T', ' '), form_name, name, phone, email, zipcode, (message || '').replace(/\r?\n/g, ' ')];
    if (!fs.existsSync(csvPath)) {
      fs.writeFileSync(csvPath, 'Date,Form,Name,Phone,Email,ZipCode,Message\n');
    }
    fs.appendFileSync(csvPath, csvLine.map(csvEscape).join(',') + '\n');
    csv_saved = true;
  } catch (_) {}

  let mail_sent = false;
  const smtpPass = (process.env.SMTP_PASS || '').trim().replace(/\s+/g, '');
  const smtpUser = (process.env.SMTP_USER || '').trim();
  const smtpHost = (process.env.SMTP_HOST || '').trim();
  if (smtpPass && smtpPass.length >= 10 && smtpUser && smtpHost) {
    try {
      const transport = nodemailer.createTransport({
        host: smtpHost,
        port: Number(process.env.SMTP_PORT) || 587,
        secure: false,
        auth: { user: smtpUser, pass: smtpPass },
      });
      await transport.sendMail({
        from: `"${process.env.SMTP_FROM_NAME || 'Senior Floors Website'}" <${process.env.SMTP_FROM_EMAIL || smtpUser}>`,
        to: process.env.SMTP_TO_EMAIL || process.env.SMTP_FROM_EMAIL || smtpUser,
        subject: `New Lead - ${form_name === 'hero-form' ? 'Hero Form' : 'Contact Form'}`,
        text: `Form: ${form_name}\nName: ${name}\nPhone: ${phone}\nEmail: ${email}\nZip: ${zipcode}\n\nMessage:\n${message || '(none)'}`,
        replyTo: `${name} <${email}>`,
      });
      mail_sent = true;
    } catch (_) {}
  }

  const response = {
    success: true,
    message: "Thank you! We'll contact you within 24 hours.",
    email_sent: mail_sent,
    system_sent,
    system_database_saved,
    database_saved: system_database_saved,
    csv_saved,
    lead_id,
    timestamp: new Date().toISOString().slice(0, 19).replace('T', ' '),
  };
  if (system_error) response.system_error = system_error;
  return res.status(200).json(response);
}
