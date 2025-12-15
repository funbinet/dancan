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

  const subject = `New message from ${safeName}`;
  const html = `
    <p><strong>Name:</strong> ${safeName}</p>
    <p><strong>Email:</strong> ${safeEmail}</p>
    <div>${safeMessage.replace(/\n/g, '<br>')}</div>
  `;

  try {
    await resend.emails.send({
      from: `${safeName} <${fromEmail}>`,
      to: toEmail,
      subject,
      html,
    });

    console.log(`Contact message sent to ${toEmail} from ${safeEmail}`);
    return res.status(200).json({ success: true, message: 'Message sent — thank you!' });
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

    return res.status(500).json({ success: false, message: 'Email failed to send' });
  }
};
