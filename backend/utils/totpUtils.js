const { authenticator } = require('otplib');
const QRCode = require('qrcode');

function generateTotpSecret() {
  return authenticator.generateSecret();
}

function getOtpauthUrl(email, secret) {
  return authenticator.keyuri(email, 'NeuroExo-Predict', secret);
}

async function generateQrCodeDataUrl(otpauthUrl) {
  return QRCode.toDataURL(otpauthUrl);
}

async function verifyTotpToken(token, secret) {
  try {
    return authenticator.verify({ token, secret });
  } catch {
    return false;
  }
}

module.exports = {
  generateTotpSecret,
  getOtpauthUrl,
  generateQrCodeDataUrl,
  verifyTotpToken,
};