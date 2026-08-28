import { ulid } from 'ulidx'

export type MailIdPrefix = 'cmp' | 'dst' | 'rcp'

export const createId = (prefix: MailIdPrefix) => `${prefix}_${ulid()}`

export const createDistributionId = () => createId('dst')

export const createCampaignId = () => createId('cmp')

export const createRecipientId = () => createId('rcp')
