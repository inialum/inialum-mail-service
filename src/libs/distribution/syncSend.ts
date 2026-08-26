import type { Bindings } from '../../types/Bindings'
import type { SendApiRequestV1 } from '../api/v1/schema/send'
import { acceptDistribution } from './accept'
import { finalizeRecipientDelivery } from './indexRecipient'

export type SyncSendRecord = {
	distributionId: string
	campaignId: string
}

export const createSyncDistribution = async (
	bindings: Pick<
		Bindings,
		'DB' | 'MAIL_LOGS_BUCKET' | 'MAIL_SEND_QUEUE' | 'ENVIRONMENT'
	>,
	data: SendApiRequestV1,
	idempotencyKey?: string,
): Promise<SyncSendRecord> => {
	const accepted = await acceptDistribution(bindings, {
		kind: 'transactional',
		source: 'send',
		from: data.from,
		subject: data.subject,
		body: data.body,
		recipients: [{ email: data.to }],
		requestedRecipients: 1,
		idempotencyKey,
		enqueue: false,
	})

	const campaignId = accepted.campaignIds[0]
	if (!campaignId) {
		throw new Error('Sync send did not create a campaign')
	}

	return {
		distributionId: accepted.distributionId,
		campaignId,
	}
}

export const finalizeSyncDistribution = async (
	bindings: Pick<Bindings, 'DB' | 'MAIL_LOGS_BUCKET' | 'ENVIRONMENT'>,
	record: SyncSendRecord,
	email: string,
	result: {
		status: 'sent' | 'failed'
		providerMessageId?: string
		error?: string
		duplicatePossible?: boolean
	},
) => {
	await finalizeRecipientDelivery({
		database: bindings.DB,
		bucket: bindings.MAIL_LOGS_BUCKET,
		environment: bindings.ENVIRONMENT,
		campaignId: record.campaignId,
		email,
		status: result.status,
		providerMessageId: result.providerMessageId,
		error: result.error,
		attempts: 1,
		duplicatePossible: result.duplicatePossible,
	})
}
