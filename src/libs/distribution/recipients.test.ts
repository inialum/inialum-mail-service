import {
	MAX_DISTRIBUTION_RECIPIENTS,
	RECIPIENTS_PER_CAMPAIGN,
} from '../../constants/distribution'
import { RECIPIENTS_PER_CHUNK } from '../../constants/mail'
import {
	chunkItems,
	dedupeRecipients,
	splitIntoCampaigns,
	splitIntoChunks,
} from './recipients'

describe('distribution recipients', () => {
	test('dedupes trim and case while keeping the first address', () => {
		expect(
			dedupeRecipients([
				{ email: ' Ada@example.com ' },
				{ email: 'ada@example.com' },
				{ email: 'bob@example.com', unsubscribeToken: 'tok' },
			]),
		).toEqual([
			{ email: 'Ada@example.com' },
			{ email: 'bob@example.com', unsubscribeToken: 'tok' },
		])
	})

	test('splits 401 and 800 recipients into two campaigns of 400', () => {
		const fourOhOne = Array.from({ length: 401 }, (_, index) => ({
			email: `user${index}@example.com`,
		}))
		const eightHundred = Array.from({ length: 800 }, (_, index) => ({
			email: `user${index}@example.com`,
		}))

		expect(splitIntoCampaigns(fourOhOne)).toHaveLength(2)
		expect(splitIntoCampaigns(fourOhOne)[0]).toHaveLength(
			RECIPIENTS_PER_CAMPAIGN,
		)
		expect(splitIntoCampaigns(fourOhOne)[1]).toHaveLength(1)
		expect(splitIntoCampaigns(eightHundred)).toHaveLength(2)
		expect(splitIntoCampaigns(eightHundred)[1]).toHaveLength(
			RECIPIENTS_PER_CAMPAIGN,
		)
		expect(MAX_DISTRIBUTION_RECIPIENTS).toBe(800)
	})

	test('chunks campaigns into 40-recipient queue messages', () => {
		const recipients = Array.from({ length: 85 }, (_, index) => ({
			email: `user${index}@example.com`,
		}))
		const chunks = splitIntoChunks(recipients)

		expect(chunks).toHaveLength(3)
		expect(chunks[0]).toHaveLength(RECIPIENTS_PER_CHUNK)
		expect(chunks[2]).toHaveLength(5)
		expect(chunkItems(recipients, 40)).toEqual(chunks)
	})
})
