import {
	createCampaignId,
	createDistributionId,
	createRecipientId,
} from './ids'

describe('mail ids', () => {
	test('uses the frozen Phase 0 prefixes', () => {
		expect(createDistributionId()).toMatch(/^dst_[0-9A-HJKMNP-TV-Z]{26}$/)
		expect(createCampaignId()).toMatch(/^cmp_[0-9A-HJKMNP-TV-Z]{26}$/)
		expect(createRecipientId()).toMatch(/^rcp_[0-9A-HJKMNP-TV-Z]{26}$/)
	})
})
