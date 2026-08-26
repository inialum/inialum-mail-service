import wrangler from '../../wrangler.json'
import { MAIL_CRON_EXPRESSION } from './distribution'
import { RECIPIENTS_PER_CHUNK } from './mail'

describe('distribution constants', () => {
	test('keeps the scheduled cron in sync with wrangler', () => {
		expect(MAIL_CRON_EXPRESSION).toBe('0 17 * * *')
		expect(wrangler.triggers.crons).toEqual([MAIL_CRON_EXPRESSION])
		expect(RECIPIENTS_PER_CHUNK).toBeLessThanOrEqual(40)
	})
})
