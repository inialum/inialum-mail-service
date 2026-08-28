export const distributionKinds = ['transactional', 'marketing'] as const

export const subscriptionKinds = ['inialum', 'university'] as const

export const distributionStatuses = [
	'accepted',
	'processing',
	'completed',
	'partial_failed',
	'failed',
] as const

export const recipientStatuses = ['pending', 'sent', 'failed'] as const

export type DistributionKind = (typeof distributionKinds)[number]
export type SubscriptionKind = (typeof subscriptionKinds)[number]
export type DistributionStatus = (typeof distributionStatuses)[number]
export type RecipientStatus = (typeof recipientStatuses)[number]
