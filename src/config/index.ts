import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).optional(),
  PORT: z.string().default('3000').transform((val) => parseInt(val, 10)),
  MAX_FILE_SIZE_MB: z.string().default('20').transform((val) => parseInt(val, 10)),
  BODY_LIMIT_MB: z.string().default('50').transform((val) => parseInt(val, 10)),
  
  // Google Gemini Configuration
  GEMINI_API_KEY: z.string().min(1, 'GEMINI_API_KEY is required in .env'),
  GEMINI_MODEL: z.string().min(1, 'GEMINI_MODEL is required in .env (e.g. gemini-3.8-flash or gemini-2.5-flash)'),
  
  // AWS S3 Configuration
  AWS_REGION: z.string().min(1, 'AWS_REGION is required in .env'),
  AWS_ACCESS_KEY_ID: z.string().min(1, 'AWS_ACCESS_KEY_ID is required in .env'),
  AWS_SECRET_ACCESS_KEY: z.string().min(1, 'AWS_SECRET_ACCESS_KEY is required in .env'),
  AWS_S3_BUCKET_NAME: z.string().min(1, 'AWS_S3_BUCKET_NAME is required in .env'),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error('❌ Invalid environment configuration:');
  for (const issue of parsedEnv.error.issues) {
    console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  }

  if (process.env.NODE_ENV === 'production') {
    console.error('Terminating: missing required configuration in production.');
    process.exit(1);
  }
}

const env = parsedEnv.success ? parsedEnv.data : (process.env as unknown as z.infer<typeof envSchema>);

export const config = {
  env: env.NODE_ENV || 'development',
  isProduction: (env.NODE_ENV || process.env.NODE_ENV) === 'production',
  isDevelopment: (env.NODE_ENV || process.env.NODE_ENV) === 'development',
  isTest: (env.NODE_ENV || process.env.NODE_ENV) === 'test',
  logLevel:
    env.LOG_LEVEL ||
    ((env.NODE_ENV || process.env.NODE_ENV) === 'production' ? 'info' : 'debug'),
  port: Number(env.PORT) || 3000,
  maxFileSizeMb: Number(env.MAX_FILE_SIZE_MB) || 20,
  bodyLimitMb: Number(env.BODY_LIMIT_MB) || 50,
  bodyLimit: `${Number(env.BODY_LIMIT_MB) || 50}mb`,
  gemini: {
    apiKey: env.GEMINI_API_KEY || '',
    model: env.GEMINI_MODEL || '',
  },
  aws: {
    region: env.AWS_REGION || 'us-east-1',
    accessKeyId: env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY || '',
    bucketName: env.AWS_S3_BUCKET_NAME || '',
  },
};
