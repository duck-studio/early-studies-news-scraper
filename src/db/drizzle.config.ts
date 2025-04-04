import fs from 'node:fs';
import path from 'node:path';
import type { Config } from 'drizzle-kit';
import { z } from 'zod';

const getLocalD1 = () => {
  try {
    // This is a bit of a hack to get the path to the local D1 database
    // It's not ideal, but it works for now
    const basePath = path.resolve('./.wrangler');
    const dbFile = fs
      .readdirSync(basePath, { encoding: 'utf-8', recursive: true })
      .find((f) => f.endsWith('.sqlite'));

    if (!dbFile) {
      throw new Error(`.sqlite file not found in ${basePath}`);
    }

    const url = path.resolve(basePath, dbFile);
    return url;
  } catch (err) {
    console.log(`Error  ${err}`);
  }
};

const baseConfig = {
  schema: './src/db/index.ts',
  out: './src/db/migrations',
  dialect: 'sqlite',
} as const;

let drizzleConfig: Config;

const env = z.object({
  LOCAL: z.union([z.literal('true'), z.literal('false')]),
  CLOUDFLARE_DATABASE_ID: z.string(),
  CLOUDFLARE_D1_TOKEN: z.string(),
  CLOUDFLARE_ACCOUNT_ID: z.string(),
});

const parsedEnv = env.parse(process.env);

if (parsedEnv.LOCAL === 'true') {
  drizzleConfig = {
    ...baseConfig,
    dbCredentials: {
      // biome-ignore lint/style/noNonNullAssertion: We know that the local D1 database is always available
      url: getLocalD1()!,
    },
  };
} else {
  drizzleConfig = {
    ...baseConfig,
    driver: 'd1-http',
    dbCredentials: {
      databaseId: parsedEnv.CLOUDFLARE_DATABASE_ID,
      token: parsedEnv.CLOUDFLARE_D1_TOKEN,
      accountId: parsedEnv.CLOUDFLARE_ACCOUNT_ID,
    },
  };
}

export default drizzleConfig;
