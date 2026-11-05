const nodemailer = require('nodemailer');
async function sendEnquiryEmail(enquiry) {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS || !process.env.ADMIN_EMAIL) return { sent: false, reason: 'SMTP is not configured' };
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE).toLowerCase() === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
  await transporter.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to: process.env.ADMIN_EMAIL,
    subject: `New Dream Estate enquiry ${enquiry.code}`,
    text: `New property enquiry\nEnquiry: ${enquiry.code}\nCustomer: ${enquiry.name}\nPhone: ${enquiry.phone}\nEmail: ${enquiry.email}\nProperty: ${enquiry.propertyTitle || 'Not selected'}\nBudget: ${enquiry.budget || 'Not specified'}\nRequirements: ${enquiry.requirements || 'None'}\nMessage: ${enquiry.message || 'None'}`
  });
  return { sent: true };
}
module.exports = { sendEnquiryEmail };
