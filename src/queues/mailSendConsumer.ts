import {
	LOCAL_SES_API_ENDPOINT,
	QUEUE_CONSUMER_MAX_BATCH_SIZE,
	QUEUE_CONSUMER_MAX_RETRIES,
	QUEUE_CONSUMER_SES_MAX_ATTEMPTS,
} from '../constants/mail'
import {
	finalizeRecipientDelivery,
	getExistingSentOutcome,
} from '../libs/distribution/indexRecipient'
import { reportQueueError } from '../libs/error/reportQueueError'
import {
	getCampaignChunkProgress,
	getCampaignManifest,
	getCampaignStatus,
	resolveCampaignStatus,
	saveCampaignChunkProgress,
	updateCampaignStatus,
} from '../libs/mail/campaignStore'
import { isInvocationBudgetExhaustedError } from '../libs/mail/invocationBudget'
import { saveRecipientFailureLog } from '../libs/mail/r2Logger'
import {
	isMailWatchdogMessage,
	runMailSendWatchdog,
} from '../libs/mail/sendWatchdog'
import { sendEmailWithSES } from '../libs/mail/ses'
import {
	buildMarketingSendContent,
	isMailQueueRecipient,
	parseQueueRecipient,
} from '../libs/mail/unsubscribe'
import type { Bindings } from '../types/Bindings'
import type { MailCampaignChunkProgress } from '../types/MailCampaign'
import type { MailQueueMessage } from '../types/MailQueueMessage'

const SEND_INTERVAL_MS = 125
const MAX_RECIPIENT_ATTEMPTS = 5
const RETRY_DELAY_SECONDS = 30

const sleep = (ms: number) =>
	new Promise<void>((resolve) => {
		setTimeout(resolve, ms)
	})

const toError = (error: unknown) =>
	error instanceof Error ? error : new Error(String(error))

const logQueueEvent = (event: string, data: Record<string, unknown>) => {
	console.error(
		JSON.stringify({
			event,
			...data,
		}),
	)
}

const isTerminalCampaignStatus = (status: string) =>
	status === 'completed' || status === 'partial_failed' || status === 'failed'

const isMailQueueMessage = (value: unknown): value is MailQueueMessage => {
	if (!value || typeof value !== 'object') {
		return false
	}

	const message = value as Partial<MailQueueMessage>
	return (
		typeof message.campaignId === 'string' &&
		typeof message.chunkIndex === 'number' &&
		(message.distributionId === undefined ||
			typeof message.distributionId === 'string') &&
		Array.isArray(message.recipients) &&
		message.recipients.every((recipient) => isMailQueueRecipient(recipient))
	)
}

const recordDeliveryHistory = async (
	bindings: Bindings,
	campaignId: string,
	recipient: string,
	result: {
		status: 'sent' | 'failed'
		providerMessageId?: string
		error?: string
		attempts: number
		duplicatePossible?: boolean
	},
) => {
	try {
		await finalizeRecipientDelivery({
			database: bindings.DB,
			bucket: bindings.MAIL_LOGS_BUCKET,
			environment: bindings.ENVIRONMENT,
			campaignId,
			email: recipient,
			status: result.status,
			providerMessageId: result.providerMessageId,
			error: result.error,
			attempts: result.attempts,
			duplicatePossible: result.duplicatePossible,
		})
	} catch (error) {
		logQueueEvent('mail_history.finalize_failed', {
			campaignId,
			recipient,
			status: result.status,
			error: error instanceof Error ? error.message : String(error),
		})
	}
}

const buildNextChunkProgress = (
	progress: MailCampaignChunkProgress,
	recipientOffset: number,
	currentRecipientAttempts: number,
	isCompleted: boolean,
	timestamp: string,
): MailCampaignChunkProgress => ({
	...progress,
	nextRecipientOffset: recipientOffset,
	currentRecipientAttempts,
	completedAt: isCompleted ? timestamp : undefined,
})

const updateDeliveryStatus = async (
	bindings: Bindings,
	campaignId: string,
	startedAt: string,
	result: 'sent' | 'failed',
) => {
	await updateCampaignStatus(
		bindings.MAIL_LOGS_BUCKET,
		bindings.ENVIRONMENT,
		campaignId,
		(current) => {
			const processedRecipients = current.processedRecipients + 1
			const sentRecipients =
				result === 'sent' ? current.sentRecipients + 1 : current.sentRecipients
			const failedRecipients =
				result === 'failed'
					? current.failedRecipients + 1
					: current.failedRecipients
			const status = resolveCampaignStatus({
				processedRecipients,
				uniqueRecipients: current.uniqueRecipients,
				sentRecipients,
				failedRecipients,
			})

			return {
				...current,
				status,
				processedRecipients,
				sentRecipients,
				failedRecipients,
				startedAt: current.startedAt ?? startedAt,
				completedAt:
					processedRecipients === current.uniqueRecipients
						? new Date().toISOString()
						: undefined,
			}
		},
	)
}

const markCampaignProcessing = async (
	bindings: Bindings,
	campaignId: string,
	startedAt: string,
) => {
	await updateCampaignStatus(
		bindings.MAIL_LOGS_BUCKET,
		bindings.ENVIRONMENT,
		campaignId,
		(current) => {
			if (
				current.status === 'completed' ||
				current.status === 'partial_failed' ||
				current.status === 'failed'
			) {
				return current
			}

			return {
				...current,
				status: 'processing',
				startedAt: current.startedAt ?? startedAt,
			}
		},
	)
}

const markCampaignFailed = async (
	bindings: Bindings,
	campaignId: string,
	startedAt: string,
) => {
	try {
		await updateCampaignStatus(
			bindings.MAIL_LOGS_BUCKET,
			bindings.ENVIRONMENT,
			campaignId,
			(current) => {
				if (
					current.status === 'completed' ||
					current.status === 'partial_failed' ||
					current.status === 'failed'
				) {
					return current
				}

				return {
					...current,
					status: 'failed',
					startedAt: current.startedAt ?? startedAt,
					completedAt: new Date().toISOString(),
				}
			},
		)
	} catch (error) {
		console.error('Failed to update campaign status to failed:', error)
	}
}

const requeueChunkMessage = async (
	bindings: Bindings,
	messageBody: MailQueueMessage,
) => {
	await bindings.MAIL_SEND_QUEUE.send(messageBody, {
		contentType: 'json',
		delaySeconds: RETRY_DELAY_SECONDS,
	})
}

const retryWithoutConsumingRecipientAttempts = async ({
	bindings,
	batch,
	message,
	messageBody,
	progress,
	startedAt,
	recipient,
	error,
	deliveryOutcomeUnknown,
	summary,
}: {
	bindings: Bindings
	batch: MessageBatch<unknown>
	message: Message<unknown>
	messageBody: MailQueueMessage
	progress: MailCampaignChunkProgress
	startedAt: string
	recipient?: string
	error: Error
	deliveryOutcomeUnknown: boolean
	summary: {
		retried: number
		budgetExhausted: number
	}
}) => {
	summary.budgetExhausted += 1
	summary.retried += 1
	const willRetry = message.attempts <= QUEUE_CONSUMER_MAX_RETRIES

	logQueueEvent('mail_send_queue.invocation_budget_exhausted', {
		queue: batch.queue,
		environment: bindings.ENVIRONMENT,
		reason: 'invocation_budget_exhausted',
		messageId: message.id,
		campaignId: messageBody.campaignId,
		chunkIndex: messageBody.chunkIndex,
		recipient,
		nextRecipientOffset: progress.nextRecipientOffset,
		attempts: progress.currentRecipientAttempts,
		queueAttempts: message.attempts,
		willRetry,
		delivery_outcome_unknown: deliveryOutcomeUnknown,
		sesMaxAttempts: QUEUE_CONSUMER_SES_MAX_ATTEMPTS,
		queueConsumerMaxBatchSize: QUEUE_CONSUMER_MAX_BATCH_SIZE,
		errorName: error.name,
		errorMessage: error.message,
	})

	// Do not rewrite chunk progress here: leave R2 state as-is so a successful
	// send that failed during bookkeeping is not rolled back, and a failed send
	// keeps the unsent offset / attempt counters unchanged.

	if (!willRetry) {
		await markCampaignFailed(bindings, messageBody.campaignId, startedAt)
		await reportQueueError(error, bindings.ERROR_NOTIFICATION_TOKEN, {
			queue: batch.queue,
			environment: bindings.ENVIRONMENT,
			reason: 'invocation budget exhaustion retries exhausted',
			messageId: message.id,
			campaignId: messageBody.campaignId,
			recipient,
			attempts: message.attempts,
			willRetry: false,
		})
	}

	// Keep the same queue message so max_retries and DLQ delivery remain effective.
	// Recipient attempts live in R2 and are intentionally unchanged here.
	message.retry({
		delaySeconds: RETRY_DELAY_SECONDS,
	})
}

export const handleMailSendQueue = async (
	batch: MessageBatch<unknown>,
	bindings: Bindings,
	sendIntervalMs: number = SEND_INTERVAL_MS,
) => {
	const summary = {
		processed: 0,
		succeeded: 0,
		retried: 0,
		invalid: 0,
		budgetExhausted: 0,
		requeued: 0,
	}
	const endpoint =
		bindings.ENVIRONMENT === 'production' || bindings.ENVIRONMENT === 'staging'
			? undefined
			: LOCAL_SES_API_ENDPOINT

	console.log(
		JSON.stringify({
			event: 'mail_send_queue.batch_started',
			queue: batch.queue,
			environment: bindings.ENVIRONMENT,
			messageCount: batch.messages.length,
			queueConsumerMaxBatchSize: QUEUE_CONSUMER_MAX_BATCH_SIZE,
			sesMaxAttempts: QUEUE_CONSUMER_SES_MAX_ATTEMPTS,
		}),
	)

	for (const message of batch.messages) {
		summary.processed += 1

		if (isMailWatchdogMessage(message.body)) {
			await runMailSendWatchdog({
				bindings,
				queue: batch.queue,
				message: {
					id: message.id,
					body: message.body,
					ack: () => message.ack(),
					retry: (options) => message.retry(options),
				},
			})
			continue
		}

		if (!isMailQueueMessage(message.body)) {
			summary.invalid += 1
			const invalidPayloadError = new Error('Invalid queue payload detected')
			logQueueEvent('mail_send_queue.invalid_payload', {
				queue: batch.queue,
				environment: bindings.ENVIRONMENT,
				messageId: message.id,
				attempts: message.attempts,
			})
			await reportQueueError(
				invalidPayloadError,
				bindings.ERROR_NOTIFICATION_TOKEN,
				{
					queue: batch.queue,
					environment: bindings.ENVIRONMENT,
					reason: 'invalid payload acknowledged',
					messageId: message.id,
					attempts: message.attempts,
					willRetry: false,
				},
			)
			message.ack()
			continue
		}

		const startedAt = new Date().toISOString()

		try {
			const [manifest, progress, status] = await Promise.all([
				getCampaignManifest(
					bindings.MAIL_LOGS_BUCKET,
					bindings.ENVIRONMENT,
					message.body.campaignId,
				),
				getCampaignChunkProgress(
					bindings.MAIL_LOGS_BUCKET,
					bindings.ENVIRONMENT,
					message.body.campaignId,
					message.body.chunkIndex,
				),
				getCampaignStatus(
					bindings.MAIL_LOGS_BUCKET,
					bindings.ENVIRONMENT,
					message.body.campaignId,
				),
			])

			if (!manifest || !progress || !status) {
				const missingCampaignDataError = new Error('Campaign data not found')
				if (status) {
					await markCampaignFailed(bindings, message.body.campaignId, startedAt)
				}
				await reportQueueError(
					missingCampaignDataError,
					bindings.ERROR_NOTIFICATION_TOKEN,
					{
						queue: batch.queue,
						environment: bindings.ENVIRONMENT,
						reason: 'campaign data missing',
						messageId: message.id,
						campaignId: message.body.campaignId,
						attempts: message.attempts,
						willRetry: false,
					},
				)
				message.ack()
				continue
			}

			if (isTerminalCampaignStatus(status.status)) {
				message.ack()
				continue
			}

			if (
				progress.completedAt ||
				progress.nextRecipientOffset >= message.body.recipients.length
			) {
				message.ack()
				continue
			}

			await markCampaignProcessing(bindings, message.body.campaignId, startedAt)

			let shouldContinueWithNextQueueMessage = false

			for (
				let recipientOffset = progress.nextRecipientOffset;
				recipientOffset < message.body.recipients.length;
				recipientOffset += 1
			) {
				const parsedRecipient = parseQueueRecipient(
					message.body.recipients[recipientOffset],
				)
				if (!parsedRecipient) {
					logQueueEvent('mail_send_queue.invalid_recipient', {
						campaignId: message.body.campaignId,
						chunkIndex: message.body.chunkIndex,
						recipientOffset,
					})
					message.ack()
					shouldContinueWithNextQueueMessage = true
					break
				}
				const recipient = parsedRecipient.email
				const currentRecipientAttempts =
					recipientOffset === progress.nextRecipientOffset
						? progress.currentRecipientAttempts + 1
						: 1
				let didSendRecipient = false
				let alreadySent = null as Awaited<
					ReturnType<typeof getExistingSentOutcome>
				>

				try {
					alreadySent = await getExistingSentOutcome({
						database: bindings.DB,
						bucket: bindings.MAIL_LOGS_BUCKET,
						environment: bindings.ENVIRONMENT,
						campaignId: message.body.campaignId,
						email: recipient,
					})
				} catch (error) {
					logQueueEvent('mail_history.lookup_failed', {
						campaignId: message.body.campaignId,
						recipient,
						error: error instanceof Error ? error.message : String(error),
					})
				}

				try {
					if (alreadySent) {
						didSendRecipient = true
						summary.succeeded += 1
					} else {
						const marketingContent = buildMarketingSendContent({
							body: manifest.body,
							token: parsedRecipient.unsubscribeToken,
							unsubscribeBaseUrl: bindings.UNSUBSCRIBE_BASE_URL,
						})
						if (
							parsedRecipient.unsubscribeToken &&
							marketingContent.placeholderMissing
						) {
							logQueueEvent('mail_send_queue.unsubscribe_placeholder_missing', {
								campaignId: message.body.campaignId,
								distributionId: message.body.distributionId,
							})
						}
						if (
							parsedRecipient.unsubscribeToken &&
							!bindings.UNSUBSCRIBE_BASE_URL
						) {
							logQueueEvent('mail_send_queue.unsubscribe_base_url_missing', {
								campaignId: message.body.campaignId,
								distributionId: message.body.distributionId,
							})
						}

						const ses = await sendEmailWithSES(
							{
								fromAddress: manifest.from,
								toAddresses: [recipient],
								subject: manifest.subject,
								body: marketingContent.body,
								...(marketingContent.headers
									? { headers: marketingContent.headers }
									: {}),
							},
							{
								accessKeyId: bindings.AWS_ACCESS_KEY_ID,
								secretAccessKey: bindings.AWS_SECRET_ACCESS_KEY,
							},
							endpoint,
							{
								maxAttempts: QUEUE_CONSUMER_SES_MAX_ATTEMPTS,
							},
						)

						await recordDeliveryHistory(
							bindings,
							message.body.campaignId,
							recipient,
							{
								status: 'sent',
								providerMessageId: ses.MessageId,
								attempts: currentRecipientAttempts,
							},
						)
						didSendRecipient = true
						summary.succeeded += 1
					}
				} catch (error) {
					const resolvedError = toError(error)

					if (isInvocationBudgetExhaustedError(resolvedError)) {
						await retryWithoutConsumingRecipientAttempts({
							bindings,
							batch,
							message,
							messageBody: message.body,
							progress,
							startedAt,
							recipient,
							error: resolvedError,
							// SES accept/reject is unknown when the Worker subrequest budget trips.
							deliveryOutcomeUnknown: true,
							summary,
						})
						shouldContinueWithNextQueueMessage = true
						break
					}

					logQueueEvent('mail_send_queue.delivery_failed', {
						queue: batch.queue,
						environment: bindings.ENVIRONMENT,
						messageId: message.id,
						campaignId: message.body.campaignId,
						recipient,
						attempts: currentRecipientAttempts,
						willRetry: currentRecipientAttempts < MAX_RECIPIENT_ATTEMPTS,
						errorName: resolvedError.name,
						errorMessage: resolvedError.message,
					})

					if (currentRecipientAttempts < MAX_RECIPIENT_ATTEMPTS) {
						summary.retried += 1
						await saveCampaignChunkProgress(
							bindings.MAIL_LOGS_BUCKET,
							buildNextChunkProgress(
								progress,
								recipientOffset,
								currentRecipientAttempts,
								false,
								new Date().toISOString(),
							),
						)

						try {
							await requeueChunkMessage(bindings, message.body)
							summary.requeued += 1
							message.ack()
							shouldContinueWithNextQueueMessage = true
							break
						} catch (requeueError) {
							await reportQueueError(
								toError(requeueError),
								bindings.ERROR_NOTIFICATION_TOKEN,
								{
									queue: batch.queue,
									environment: bindings.ENVIRONMENT,
									reason: 'continuation enqueue failed',
									messageId: message.id,
									campaignId: message.body.campaignId,
									recipient,
									attempts: currentRecipientAttempts,
									willRetry: true,
								},
							)
							message.retry({
								delaySeconds: RETRY_DELAY_SECONDS,
							})
							shouldContinueWithNextQueueMessage = true
							break
						}
					}

					const notificationSucceeded = await reportQueueError(
						resolvedError,
						bindings.ERROR_NOTIFICATION_TOKEN,
						{
							queue: batch.queue,
							environment: bindings.ENVIRONMENT,
							reason: 'final delivery failure',
							messageId: message.id,
							campaignId: message.body.campaignId,
							recipient,
							attempts: currentRecipientAttempts,
							willRetry: false,
						},
					)

					await saveRecipientFailureLog(bindings.MAIL_LOGS_BUCKET, {
						environment: bindings.ENVIRONMENT,
						campaignId: message.body.campaignId,
						timestamp: new Date().toISOString(),
						from: manifest.from,
						to: recipient,
						subject: manifest.subject,
						attempts: currentRecipientAttempts,
						error: resolvedError.message,
						notification_failed: !notificationSucceeded,
					})
					await recordDeliveryHistory(
						bindings,
						message.body.campaignId,
						recipient,
						{
							status: 'failed',
							error: resolvedError.message,
							attempts: currentRecipientAttempts,
						},
					)
					await saveCampaignChunkProgress(
						bindings.MAIL_LOGS_BUCKET,
						buildNextChunkProgress(
							progress,
							recipientOffset + 1,
							0,
							recipientOffset + 1 >= message.body.recipients.length,
							new Date().toISOString(),
						),
					)
					await updateDeliveryStatus(
						bindings,
						message.body.campaignId,
						startedAt,
						'failed',
					)
				}

				if (!didSendRecipient) {
					if (sendIntervalMs > 0) {
						await sleep(sendIntervalMs)
					}
					continue
				}

				try {
					await saveCampaignChunkProgress(
						bindings.MAIL_LOGS_BUCKET,
						buildNextChunkProgress(
							progress,
							recipientOffset + 1,
							0,
							recipientOffset + 1 >= message.body.recipients.length,
							new Date().toISOString(),
						),
					)
					await updateDeliveryStatus(
						bindings,
						message.body.campaignId,
						startedAt,
						'sent',
					)
				} catch (error) {
					const resolvedError = toError(error)

					if (isInvocationBudgetExhaustedError(resolvedError)) {
						await retryWithoutConsumingRecipientAttempts({
							bindings,
							batch,
							message,
							messageBody: message.body,
							// Recipient may already have been accepted by SES; progress not advanced.
							progress,
							startedAt,
							recipient,
							error: resolvedError,
							deliveryOutcomeUnknown: true,
							summary,
						})
						shouldContinueWithNextQueueMessage = true
						break
					}

					await markCampaignFailed(bindings, message.body.campaignId, startedAt)
					await reportQueueError(
						resolvedError,
						bindings.ERROR_NOTIFICATION_TOKEN,
						{
							queue: batch.queue,
							environment: bindings.ENVIRONMENT,
							reason: 'campaign bookkeeping failed after send',
							messageId: message.id,
							campaignId: message.body.campaignId,
							recipient,
							attempts: message.attempts,
							willRetry: false,
						},
					)
					message.ack()
					shouldContinueWithNextQueueMessage = true
					break
				}

				if (sendIntervalMs > 0) {
					await sleep(sendIntervalMs)
				}
			}

			if (shouldContinueWithNextQueueMessage) {
				continue
			}

			message.ack()
		} catch (error) {
			const resolvedError = toError(error)

			if (
				isMailQueueMessage(message.body) &&
				isInvocationBudgetExhaustedError(resolvedError)
			) {
				const progress = (await getCampaignChunkProgress(
					bindings.MAIL_LOGS_BUCKET,
					bindings.ENVIRONMENT,
					message.body.campaignId,
					message.body.chunkIndex,
				)) ?? {
					environment: bindings.ENVIRONMENT,
					campaignId: message.body.campaignId,
					chunkIndex: message.body.chunkIndex,
					nextRecipientOffset: 0,
					currentRecipientAttempts: 0,
				}

				await retryWithoutConsumingRecipientAttempts({
					bindings,
					batch,
					message,
					messageBody: message.body,
					progress,
					startedAt,
					error: resolvedError,
					deliveryOutcomeUnknown: true,
					summary,
				})
				continue
			}

			const willRetry = message.attempts <= QUEUE_CONSUMER_MAX_RETRIES
			if (!willRetry) {
				await markCampaignFailed(bindings, message.body.campaignId, startedAt)
			}
			await reportQueueError(resolvedError, bindings.ERROR_NOTIFICATION_TOKEN, {
				queue: batch.queue,
				environment: bindings.ENVIRONMENT,
				reason: willRetry
					? 'campaign processing retry scheduled'
					: 'campaign processing failed',
				messageId: message.id,
				campaignId: message.body.campaignId,
				attempts: message.attempts,
				willRetry,
			})
			if (willRetry) {
				message.retry({
					delaySeconds: RETRY_DELAY_SECONDS,
				})
			} else {
				message.ack()
			}
		}
	}

	// Queue daily ops are account-wide and counted per message write/read/delete
	// (plus an extra read on queue-level retry). Log this invocation's contribution.
	console.log(
		JSON.stringify({
			event: 'mail_send_queue.batch_completed',
			queue: batch.queue,
			environment: bindings.ENVIRONMENT,
			sesMaxAttempts: QUEUE_CONSUMER_SES_MAX_ATTEMPTS,
			queueConsumerMaxBatchSize: QUEUE_CONSUMER_MAX_BATCH_SIZE,
			queueOpsReads: summary.processed,
			queueOpsContinuationWrites: summary.requeued,
			...summary,
		}),
	)
}
