import dotenv from 'dotenv';

dotenv.config();

const requiredEnv = (name: string): string => {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`[ENV] Missing required environment variable: ${name}`);
  }
  return value.trim();
};

export const NODE_ENV = process.env.NODE_ENV || 'development';
export const IS_PRODUCTION = NODE_ENV === 'production';

export const DATABASE_URL = requiredEnv('DATABASE_URL');
export const JWT_SECRET = requiredEnv('JWT_SECRET');

// Reconstruct Apple private key PEM from Base64 if needed
if (process.env.APPLE_PRIVATE_KEY_BASE64 && !process.env.APPLE_PRIVATE_KEY) {
  const base64 = process.env.APPLE_PRIVATE_KEY_BASE64.trim();
  if (base64.includes('-----BEGIN PRIVATE KEY-----')) {
    process.env.APPLE_PRIVATE_KEY = base64;
  } else {
    try {
      const decoded = Buffer.from(base64, 'base64').toString('utf8');
      if (decoded.includes('-----BEGIN PRIVATE KEY-----')) {
        process.env.APPLE_PRIVATE_KEY = decoded;
      } else {
        // Reconstruct PEM from DER base64
        const formatted = base64.replace(/\s+/g, '');
        const chunks = formatted.match(/.{1,64}/g);
        process.env.APPLE_PRIVATE_KEY = [
          '-----BEGIN PRIVATE KEY-----',
          ...(chunks || []),
          '-----END PRIVATE KEY-----'
        ].join('\n');
      }
    } catch (e) {
      console.error("[ENV] Failed to decode APPLE_PRIVATE_KEY_BASE64:", e);
    }
  }
}

