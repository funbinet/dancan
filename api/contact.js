const { Resend } = require('resend');

// Initialize Resend with the API key from env
const resend = new Resend(process.env.RESEND_API_KEY);

/**
 * Simple serverless contact endpoint for Vercel using Resend
 * Expects JSON POST { name, email, message }
 */
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  // Support JSON body or form-encoded body
  let { name, email, message } = req.body || {};

  // If body is a string (raw urlencoded), try to parse it
  if ((!name || !email || !message) && typeof req.body === 'string') {
    try {
      const qs = require('querystring');
      const parsed = qs.parse(req.body);
      name = name || parsed.name;
      email = email || parsed.email;
      message = message || parsed.message;
    } catch (e) {
      // ignore
    }
  }

  if (!name || !email || !message) {
    return res.status(400).json({ success: false, message: 'Missing fields' });
  }

  // Basic sanitize
  const safeName = String(name).replace(/[\r\n]/g, ' ').trim();
  const safeEmail = String(email).replace(/[\r\n]/g, ' ').trim();
  const safeMessage = String(message).trim();

  const toEmail = process.env.TO_EMAIL || process.env.CONTACT_TO;
  const fromEmail = process.env.FROM_EMAIL || process.env.SMTP_FROM || `no-reply@${(toEmail || 'example.com').split('@').pop()}`;

  // Basic environment checks
  if (!process.env.RESEND_API_KEY) {
    console.error('RESEND_API_KEY is not set in environment');
    return res.status(500).json({ success: false, message: 'Server misconfiguration: RESEND_API_KEY missing' });
  }

  if (!toEmail) {
    console.error('TO_EMAIL (or CONTACT_TO) is not set in environment');
    return res.status(500).json({ success: false, message: 'Server misconfiguration: TO_EMAIL missing' });
  }

  const subject = `New message from ${safeName}`;
  const html = `
    <p><strong>Name:</strong> ${safeName}</p>
    <p><strong>Email:</strong> ${safeEmail}</p>
    <div>${safeMessage.replace(/\n/g, '<br>')}</div>
  `;

  try {
    const sendResult = await resend.emails.send({
      // Use a verified sending email as 'from' and set Reply-To to the sender so replies go to them
      from: `${safeName} <${fromEmail}>`,
      to: toEmail,
      subject,
      html,
      headers: {
        'Reply-To': safeEmail,
      },
    });

    console.log(`Contact message sent to ${toEmail} from ${safeEmail}`, { sendResult });

    // If caller requested debug (via header) or environment flag is set, include sendResult
    const debugHeader = String(req.headers['x-debug'] || '').toLowerCase();
    const debugEnabled = process.env.ENABLE_DEBUG === '1' || debugHeader === '1' || req.query?.debug === '1';

    const responsePayload = { success: true, message: 'Message sent — thank you!' };
    if (debugEnabled) {
      // include minimal non-secret info
      responsePayload.resend = { id: sendResult?.id || null, status: sendResult?.status || null };
    }

    return res.status(200).json(responsePayload);
  } catch (err) {
    console.error('Resend send error:', err);
    // Log for local debugging (note: Vercel filesystem is ephemeral; rely on Vercel logs)
    try {
      const fs = require('fs');
      const entry = `${new Date().toISOString()} | ${safeName} <${safeEmail}> | ${safeMessage.replace(/\n/g, ' ')} | error: ${err.message || err}\n`;
      fs.appendFileSync('./contact_messages.log', entry);
    } catch (e) {
      // ignore logging errors
    }
    // Surface some non-sensitive error details to help debugging
    const errMsg = err?.message || 'Email failed to send';
    return res.status(500).json({ success: false, message: 'Email failed to send', error: errMsg });
  }
};
