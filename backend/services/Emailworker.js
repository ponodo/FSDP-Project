/*
  Email worker: sends queued congratulatory emails in the background.
  - Runs every 30 seconds (started from app.js)
  - Success  -> Delivered
  - Failure  -> retry in 5 minutes, Failed after 3 attempts
  - Invalid address -> Failed straight away (no point retrying)

  SMTP settings come from .env (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM).
  If SMTP_HOST is not set, a free Ethereal test inbox is used and a preview link
  for each email is printed in the terminal (good for demos).
*/
const nodemailer = require("nodemailer");
const model = require("../models/Gradingmodel");

const INTERVAL_MS = 30 * 1000;
const BATCH = 10;
const MAX_ATTEMPTS = 3;
const RETRY_MINUTES = 5;
const VALID_EMAIL = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

let transporter = null;
let usingEthereal = false;
let running = false;

async function getTransporter() {
  if (transporter) return transporter;
  if (process.env.SMTP_HOST) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  } else {
    const acc = await nodemailer.createTestAccount();
    transporter = nodemailer.createTransport({
      host: acc.smtp.host,
      port: acc.smtp.port,
      secure: acc.smtp.secure,
      auth: { user: acc.user, pass: acc.pass },
    });
    usingEthereal = true;
    console.log("[email] No SMTP_HOST set - using Ethereal test inbox");
  }
  return transporter;
}

async function processQueue() {
  if (running) return; // don't overlap runs
  running = true;
  try {
    const due = await model.getDueNotifications(BATCH);
    if (!due.length) return;
    const tx = await getTransporter();

    for (const n of due) {
      if (!VALID_EMAIL.test(n.toEmail)) {
        await model.markAttemptFailed(n.notificationId, "Invalid email address", MAX_ATTEMPTS, RETRY_MINUTES, true);
        continue;
      }
      try {
        const info = await tx.sendMail({
          from: process.env.MAIL_FROM || '"Aikido Shinjukai" <no-reply@aikidoshinjukai.sg>',
          to: n.toEmail,
          subject: n.subject,
          text: n.body,
        });
        await model.markDelivered(n.notificationId);
        const preview = usingEthereal ? " " + nodemailer.getTestMessageUrl(info) : "";
        console.log(`[email] Delivered #${n.notificationId} to ${n.toEmail}${preview}`);
      } catch (err) {
        await model.markAttemptFailed(n.notificationId, err.message, MAX_ATTEMPTS, RETRY_MINUTES, false);
        console.warn(`[email] Failed #${n.notificationId}: ${err.message}`);
      }
    }
  } catch (err) {
    console.error("[email] Worker error:", err.message);
  } finally {
    running = false;
  }
}

function start() {
  setInterval(processQueue, INTERVAL_MS);
  setTimeout(processQueue, 3000); // first run shortly after startup
  console.log("[email] Worker started (every 30s)");
}

module.exports = { start, processQueue };