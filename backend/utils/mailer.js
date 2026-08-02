const nodemailer = require('nodemailer');
require('dotenv').config();

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASSWORD,
  },
  family: 4, // force IPv4 — corrige la majorité des timeouts Gmail sur Windows/réseaux mal configurés
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 15000,
  logger: true, // affiche l'échange SMTP complet dans la console
  debug: true,
});

// Vérifie la connexion SMTP au démarrage plutôt qu'à la première tentative d'envoi
transporter.verify((err) => {
  if (err) {
    console.error('SMTP indisponible au démarrage :', err.message);
  } else {
    console.log('SMTP prêt.');
  }
});

async function sendTempPasswordEmail(toEmail, tempPassword, role) {
  const appUrl = process.env.APP_URL || 'http://localhost:3000';

  await transporter.sendMail({
    from: `"Registre CDR NeuroExo-Predict" <${process.env.SMTP_USER}>`,
    to: toEmail,
    subject: 'Votre accès au registre clinique — mot de passe temporaire',
    html: `
      <p>Bonjour,</p>
      <p>Un compte vous a été créé sur le registre clinique NeuroExo-Predict
      avec le rôle : <strong>${role}</strong>.</p>
      <p>Votre mot de passe temporaire est : <strong>${tempPassword}</strong></p>
      <p>Ce mot de passe est <strong>valable 48h</strong> et devra être changé
      dès votre première connexion.</p>
      <p><a href="${appUrl}/login">Se connecter</a></p>
      <p>Si vous n'êtes pas à l'origine de cette demande, contactez
      l'administrateur du système.</p>
    `,
  });
}

async function sendDormantReminderEmail(toEmail, role) {
  const appUrl = process.env.APP_URL || 'http://localhost:3000';

  await transporter.sendMail({
    from: `"Registre CDR NeuroExo-Predict" <${process.env.SMTP_USER}>`,
    to: toEmail,
    subject: 'Votre compte est inactif depuis plus de 60 jours',
    html: `
      <p>Bonjour,</p>
      <p>Nous avons remarqué que vous ne vous êtes pas connecté(e) au registre clinique
      NeuroExo-Predict (rôle : <strong>${role}</strong>) depuis plus de 60 jours.</p>
      <p>Si vous utilisez toujours cette plateforme, merci de vous reconnecter prochainement
      afin de garder votre accès actif. À défaut, votre compte pourra être désactivé.</p>
      <p><a href="${appUrl}/login">Se connecter</a></p>
      <p>Si vous n'utilisez plus la plateforme, aucune action n'est requise de votre part.</p>
    `,
  });
}

async function sendCustomEmail(toEmail, subject, message) {
  // Le message est saisi en texte libre par l'admin (pas de HTML) : on
  // échappe les caractères spéciaux puis on ne convertit que les sauts de
  // ligne, pour éviter toute injection HTML via le formulaire.
  const escapeHtml = (str) => String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const htmlBody = escapeHtml(message).replace(/\n/g, '<br>');

  await transporter.sendMail({
    from: `"Registre CDR NeuroExo-Predict" <${process.env.SMTP_USER}>`,
    to: toEmail,
    subject,
    html: `
      <p>Bonjour,</p>
      <p>${htmlBody}</p>
      <p style="margin-top:24px;color:#64748b;font-size:12px;">
        Ce message vous a été envoyé depuis le registre clinique NeuroExo-Predict par un administrateur.
      </p>
    `,
  });
}

module.exports = { sendTempPasswordEmail, sendDormantReminderEmail, sendCustomEmail };