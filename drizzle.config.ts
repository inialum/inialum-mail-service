import dotenv from 'dotenv'
import { defineConfig } from 'drizzle-kit'

import { getEnv } from './src/utils/getEnv'

dotenv.config({ path: './.dev.vars' })

const accountId = getEnv(process.env.CLOUDFLARE_ACCOUNT_ID)
const databaseId = getEnv(process.env.PRODUCTION_MAIL_SERVICE_LOG_DB_ID)
const token = getEnv(process.env.CLOUDFLARE_D1_TOKEN)

export default defineConfig({
	schema: './src/libs/db/schema.ts',
	out: './migrations',
	dialect: 'sqlite',
	driver: 'd1-http',
	dbCredentials: {
		accountId,
		databaseId,
		token,
	},
	verbose: true,
	strict: true,
})
