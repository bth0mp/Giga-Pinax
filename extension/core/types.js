// @ts-check
// The shapes the store keeps and answers with, written down for the type check (jsconfig.json) and
// for a reader. This file holds comments only: nothing imports it at run time, and a module names a
// shape here in a JSDoc comment, as `@typedef {import('./types.js').Lot} Lot`. The validators in
// records.js, fields.js, drafts.js, evidence.js and money.js are what a record is actually held to;
// these typedefs describe what those validators accept and never replace them.

// --- Results ---------------------------------------------------------------------------------------

/**
 * What a failed check or command answers: a code and a message always, the path of the field that
 * failed where there is one, and the few extras a caller carries (the lot an identity collided with,
 * the ladder tier that failed).
 * @typedef {object} FailureError
 * @property {string} code
 * @property {string} message
 * @property {string} [path]
 * @property {string} [existingLotId]
 * @property {number} [tier]
 */

/**
 * @typedef {object} Failure
 * @property {false} ok
 * @property {FailureError} error
 */

/**
 * A check's answer: the value it accepted, or the failure that names why not.
 * @template T
 * @typedef {{ ok: true, value: T } | Failure} Result
 */

// --- Money -----------------------------------------------------------------------------------------

/**
 * An amount in one currency's minor units (cents). Every stored amount is one of the four currencies
 * money.js lists; nothing is ever converted or added across currencies.
 * @typedef {object} Money
 * @property {string} currency
 * @property {number} minor
 */

/**
 * @typedef {object} LadderTier
 * @property {number} from
 * @property {number} step
 */

/**
 * @typedef {object} IncrementLadder
 * @property {string} currency
 * @property {LadderTier[]} tiers
 */

// --- Records ---------------------------------------------------------------------------------------

/**
 * What every durable record carries.
 * @typedef {object} RecordBase
 * @property {string} id
 * @property {number} revision
 * @property {'collector' | 'authorized'} dataClass
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/**
 * @typedef {object} SourceLink
 * @property {'coinarchives' | 'acsearch' | 'manual' | 'authorized-import'} source
 * @property {string} url
 * @property {string} [sourceRecordId]
 */

/**
 * The auction page a lot or a draft came from.
 * @typedef {object} AuctionContext
 * @property {string} pageUrl
 * @property {string} [canonicalUrl]
 * @property {string} [house]
 * @property {string} [saleId]
 * @property {string} [lotNumber]
 */

/**
 * @typedef {object} CoinDetails
 * @property {string[]} [photoUrls]
 * @property {number} [weightMg]
 * @property {number} [diameterHundredthsMm]
 * @property {string} [condition]
 */

/**
 * @typedef {object} ProvenanceNote
 * @property {string} id
 * @property {string} text
 * @property {string} sourceUrl
 * @property {string} recordedAt
 * @property {string} [auctionDate]
 */

/**
 * The fees a bid was worked out with, in one currency.
 * @typedef {object} CostEstimate
 * @property {string} currency
 * @property {number} shippingMinor
 * @property {number} paymentFeeBps
 * @property {number} paymentFeeMinor
 * @property {number} incrementMinor
 * @property {number} minimumBidMinor
 * @property {number} [premiumVatBps] VAT charged on the buyer's premium alone
 * @property {number} [platformFeeBps] a live-bidding platform's fee on the hammer alone
 * @property {number} [importVatBps] import VAT or duty on hammer + premium + shipping, paid when the coin crosses a border
 * @property {true} [gridOnly] only the bid's increment and minimum were saved: no fee is recorded
 */

/**
 * A planned or active maximum bid. An active one records when the collector placed it with the house;
 * Giga Pinax itself never places, changes or cancels a bid.
 * @typedef {object} Bid
 * @property {Money} amount
 * @property {number} [buyerPremiumBps]
 * @property {string} [placedAt]
 */

/**
 * @typedef {'planned-revised' | 'planned-cleared' | 'placed' | 'active-revised' | 'externally-cancelled'
 *   | 'settled-won' | 'settled-lost' | 'reopened-active' | 'reopened-inactive'} BidAction
 */

/**
 * @typedef {object} BidHistoryEntry
 * @property {string} id
 * @property {BidAction} action
 * @property {string} recordedAt
 * @property {Money} [amount]
 * @property {number} [buyerPremiumBps]
 */

/** @typedef {'open' | 'won' | 'lost' | 'passed'} OutcomeStatus */

/**
 * What a won coin really cost, worked out by the store when the outcome was recorded (projections.js
 * deriveWonCost) and kept with it, so a later change to a house preset or a fee never rewrites it. Every
 * amount is in the hammer's currency. A complete cost has every part and its total; an incomplete one
 * keeps what could be worked out, names each figure that was never recorded, and has no total.
 * @typedef {object} WonCost
 * @property {number} [buyerPremiumBps] the rate on the bid the coin was won on
 * @property {Money} [premium]
 * @property {Money} [premiumVat]
 * @property {Money} [platformFee]
 * @property {Money} [shipping]
 * @property {Money} [paymentFee]
 * @property {Money} [total] hammer + premium + VAT on it + platform fee + shipping + payment fee: without import VAT, as
 *   0.36.0 checks it; the full total is `costTotal(cost)` (projections.js)
 * @property {Money} [importVat] import VAT or duty, kept beside a complete cost's total when its fee sheet has a rate
 * @property {Array<'hammer' | 'premium-rate' | 'fees' | 'fee-currency'>} [missing]
 */

/**
 * How a lot ended, as the collector recorded it. Prices here are the collector's own and are labelled
 * unverified. Only a won outcome carries a cost; one won before 0.36 carries none.
 * @typedef {object} Outcome
 * @property {OutcomeStatus} status
 * @property {Money} [hammer]
 * @property {Money} [actualInvoice]
 * @property {string} [correctedAt]
 * @property {'personal-unverified'} [verification]
 * @property {WonCost} [cost]
 * @property {OutcomeTerms} [terms]
 */

/**
 * The premium rate and fee sheet a won coin's outcome states (the Outcome form), for a coin won without a recorded bid
 * or on other terms than its bid. The cost is still worked out by the store from them; they are kept so a corrected
 * hammer is costed on them again. The fee sheet is in the hammer's currency.
 * @typedef {object} OutcomeTerms
 * @property {number} [buyerPremiumBps]
 * @property {CostEstimate | null} [costEstimate] null: no fees were charged beyond the premium
 */

/**
 * @typedef {object} OutcomeHistoryEntry
 * @property {string} id
 * @property {OutcomeStatus} from
 * @property {OutcomeStatus} to
 * @property {string} recordedAt
 * @property {boolean} [bindingActive]
 */

/**
 * A coin on the watchlist, from the first look to its outcome.
 * @typedef {RecordBase & {
 *   title: string,
 *   reference?: string,
 *   lotNumber?: string,
 *   notes?: string,
 *   sourceLinks: SourceLink[],
 *   bidHistory: BidHistoryEntry[],
 *   outcome: Outcome,
 *   outcomeHistory: OutcomeHistoryEntry[],
 *   auctionEventId?: string,
 *   alternativeGroupId?: string,
 *   collectionEntryId?: string,
 *   priority?: number,
 *   plannedBid?: Bid,
 *   activeBid?: Bid,
 *   auctionContext?: AuctionContext,
 *   coinDetails?: CoinDetails,
 *   provenanceNotes?: ProvenanceNote[],
 *   costEstimate?: CostEstimate,
 *   collectionReviewReason?: 'source-lot-no-longer-won',
 * }} Lot
 */

/**
 * A reminder before an auction event: an offset before a timed event, or a wall time some days before
 * a date-only one. A wall time saved with the collector's zone rings on their clock (reminders.js);
 * one saved without it, as every one before Q-19 was, rings at that time in the auction's zone.
 * @typedef {{ id: string, kind: 'offset', offsetMinutes: number }} OffsetReminder
 * @typedef {{ id: string, kind: 'wall-time', daysBefore: number, localTime: string, collectorTimeZone?: string }} WallTimeReminder
 * @typedef {OffsetReminder | WallTimeReminder} Reminder
 */

/**
 * An auction, a lot's closing or an auction day, in the time zone the collector confirmed. A timed one
 * carries its local time and the instant it starts; a date-only one carries neither.
 * @typedef {RecordBase & {
 *   name: string,
 *   eventKind: 'auction-starts' | 'lot-closes' | 'auction-day',
 *   localDate: string,
 *   timeZone: string,
 *   reminderScope: 'standalone' | 'linked-lots',
 *   reminders: Reminder[],
 *   capturedText?: string,
 *   capturedFromUrl?: string,
 *   sourceUrl?: string,
 * } & (
 *   { precision: 'timed', localTime: string, startsAt: string }
 *   | { precision: 'date-only', localTime?: undefined, startsAt?: undefined }
 * )} AuctionEvent
 */

/** @typedef {RecordBase & { name: string }} AlternativeGroup */

/**
 * A coin the collector won and keeps, linked both ways to the lot it came from. Its hammer follows the lot's won
 * outcome, and so does its invoice unless the collector corrected that on the entry: `editedFields` names what the
 * collector corrected here (`collection.update`), and those keep the collector's figure over an outcome correction.
 * @typedef {RecordBase & {
 *   lotId: string,
 *   title: string,
 *   acquisitionDate: string,
 *   sourceLinks: SourceLink[],
 *   notes?: string,
 *   hammer?: Money,
 *   actualInvoice?: Money,
 *   reviewReason?: 'source-lot-no-longer-won',
 *   editedFields?: Array<'acquisitionDate' | 'actualInvoice' | 'notes'>,
 * }} CollectionEntry
 */

// --- Evidence --------------------------------------------------------------------------------------

/**
 * One sale as one source reported it.
 * @typedef {object} SaleObservation
 * @property {string} id
 * @property {string} queryId
 * @property {string} [queryLabel]
 * @property {'coinarchives' | 'acsearch' | 'manual' | 'authorized-import'} source
 * @property {'collector' | 'authorized'} dataClass
 * @property {string} retrievedAt
 * @property {string} auctionDate
 * @property {'hammer' | 'hammer-plus-bp' | 'estimate' | 'unsold' | 'missing'} priceBasis
 * @property {string} auctionHouse
 * @property {string} lotNumber
 * @property {string} [houseSaleId]
 * @property {string} [auctionName]
 * @property {string} [sourceRecordId]
 * @property {string} [sourceUrl]
 * @property {{ providerRecordId: string, houseSaleId: string, basis: string }} [houseSaleIdMapping]
 * @property {Money} [amount]
 * @property {boolean} [collectorExcluded]
 * @property {string} [collectorExclusionReason]
 */

/**
 * @typedef {object} EvidenceResolution
 * @property {'hammer'} priceBasis
 * @property {Money} hammer
 * @property {'source-agreement' | 'collector-selected-observation' | 'collector-entered'} resolution
 * @property {string} [observationId]
 * @property {string} [resolvedAt]
 */

/**
 * One sale, with every observation of it: what validateSaleEvidence accepts.
 * @typedef {object} SaleEvidence
 * @property {string} id
 * @property {'collector' | 'authorized'} dataClass
 * @property {SaleObservation[]} observations
 * @property {'included' | 'excluded'} inclusion
 * @property {{ auctionHouse: string, houseSaleId: string, lotNumber: string }} [saleIdentity]
 * @property {string} [exclusionReason]
 * @property {string[]} [conflictFields]
 * @property {string} [notes]
 * @property {EvidenceResolution} [resolved]
 */

/**
 * A saved comparable as the store keeps it.
 * @typedef {RecordBase & SaleEvidence} Evidence
 */

// --- Drafts ----------------------------------------------------------------------------------------

/**
 * @typedef {object} DraftProvenanceEntry
 * @property {string} text
 * @property {string} [source]
 * @property {number} [year]
 * @property {string} [lot]
 */

/**
 * What a lot page hands the watchlist for the collector to confirm.
 * @typedef {object} CurrentLotDraftPayload
 * @property {'watchlist'} target
 * @property {string} [title]
 * @property {string} [reference]
 * @property {string} [pageUrl]
 * @property {AuctionContext} [auctionContext]
 * @property {{ minor: number, currency: string }} [estimate]
 * @property {string} [closesAt]
 * @property {string} [startsAt]
 * @property {string} [photoUrl]
 * @property {DraftProvenanceEntry[]} [provenance]
 */

/**
 * A highlighted passage or a captured auction page, handed to the workspace as text.
 * @typedef {object} TextDraftPayload
 * @property {string} [rawText]
 * @property {string} [pageUrl]
 * @property {AuctionContext} [auctionContext]
 */

/** @typedef {CurrentLotDraftPayload | TextDraftPayload} DraftPayload */

/** @typedef {'research-highlight' | 'current-lot' | 'auction-capture'} DraftKind */

/**
 * @typedef {RecordBase & { kind: DraftKind, payload: DraftPayload, expiresAt: string }} Draft
 */

// --- Reminders and alerts --------------------------------------------------------------------------

/** @typedef {'pending' | 'due' | 'claimed' | 'delivered' | 'acknowledged' | 'snoozed' | 'missed'} AlertStatus */

/**
 * One reminder's alert. Its status changes in place, and each status carries the times that status
 * requires (records.js alertResult); the others may be left from an earlier status.
 * @typedef {RecordBase & {
 *   triggerId: string,
 *   eventId: string,
 *   eventRevision: number,
 *   reminderId: string,
 *   triggerAt: string,
 *   status: AlertStatus,
 *   attemptedAt?: string,
 *   claimedAt?: string,
 *   deliveredAt?: string,
 *   acknowledgedAt?: string,
 *   snoozedUntil?: string,
 *   missedAt?: string,
 * }} Alert
 */

/**
 * One reminder of one event at one instant. A timed event's trigger carries the instant the event starts.
 * @typedef {object} ReminderTrigger
 * @property {string} id
 * @property {string} eventId
 * @property {number} eventRevision
 * @property {string} reminderId
 * @property {string} triggerAt
 * @property {string} eventName
 * @property {'timed' | 'date-only'} precision
 * @property {string} [eventStartsAt]
 * @property {string} localDate
 * @property {string} timeZone
 */

/**
 * @typedef {object} SchedulePlan
 * @property {string | null} nextWakeAt
 * @property {Record<string, ReminderTrigger[]>} overdueByEvent
 * @property {string[]} missedTriggerIds
 */

/**
 * @typedef {object} Scheduler
 * @property {number} revision
 * @property {string | null} nextWakeAt
 * @property {string | null} lastReconciledAt
 */

// --- The root --------------------------------------------------------------------------------------

/**
 * @typedef {object} HousePremiumPreset
 * @property {string} name
 * @property {number} buyerPremiumBps
 * @property {number} [premiumVatBps]
 * @property {number} [platformFeeBps]
 * @property {IncrementLadder} [incrementLadder]
 */

/**
 * @typedef {object} Preferences
 * @property {number} schemaVersion
 * @property {number} revision
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {string} currency
 * @property {boolean} desktopAlertsEnabled
 * @property {HousePremiumPreset[]} [housePremiumPresets]
 * @property {number} [importVatBps] the usual import VAT or duty for a sale in another currency than `currency`; absent is off
 */

/**
 * A link a repair had to clear, kept verbatim so it can be put back.
 * @typedef {object} ClearedReference
 * @property {string} collection
 * @property {string} id
 * @property {string} field
 * @property {*} value
 */

/**
 * A record a repair set aside, verbatim, with why; or the note of a cause that was never stored.
 * @typedef {object} QuarantineEntry
 * @property {string} collection
 * @property {string} reason
 * @property {string} quarantinedAt
 * @property {*} record
 * @property {ClearedReference[]} [clearedReferences]
 */

/**
 * A committed command in the ledger, kept so a retry of the same request is answered, not repeated.
 * @typedef {object} RecentCommand
 * @property {string} requestId
 * @property {string} commandType
 * @property {number} revision
 * @property {string} committedAt
 * @property {CommandSuccess} reply
 */

/**
 * The whole durable root, as the store writes it under its one storage key.
 * @typedef {object} Snapshot
 * @property {number} schemaVersion
 * @property {number} revision
 * @property {string} updatedAt
 * @property {Preferences | null} preferences
 * @property {Lot[]} lots
 * @property {AuctionEvent[]} auctionEvents
 * @property {AlternativeGroup[]} alternativeGroups
 * @property {Evidence[]} evidence
 * @property {CollectionEntry[]} collectionEntries
 * @property {Draft[]} drafts
 * @property {Alert[]} alerts
 * @property {Scheduler} scheduler
 * @property {RecentCommand[]} recentCommands
 * @property {QuarantineEntry[]} [quarantine]
 */

// --- Commands --------------------------------------------------------------------------------------

/**
 * A command a view sends the store: its type, the request ID a retry repeats, and the fields that
 * type takes (store.js reads each type's own).
 * @typedef {{ type: string, requestId: string, [field: string]: any }} Command
 */

/**
 * @typedef {object} CommandSuccess
 * @property {true} ok
 * @property {string} requestId
 * @property {number} revision
 * @property {*} value
 */

/**
 * A command the store refused or could not confirm. `not-committed` means nothing was written;
 * `unknown` means the write may have landed and the view must reload before retrying.
 * @typedef {object} CommandFailure
 * @property {false} ok
 * @property {string} requestId
 * @property {string} code
 * @property {'not-committed' | 'unknown'} outcome
 * @property {string} message
 * @property {FailureError} [error]
 */

/**
 * What the store answers every command with.
 * @typedef {CommandSuccess | CommandFailure} CommandResult
 */

/**
 * The clock and the IDs a command runs with: the background worker's, or a test's fixed ones.
 * @typedef {object} CommandContext
 * @property {string | (() => string)} now
 * @property {() => string} newId
 * @property {string | (() => string | undefined)} [timeZone] the collector's zone, which a date-only auction's reminders
 *   take when it is saved (Q-19, store-schedule.js); without one they ring at their time in the auction's zone
 */

/**
 * The part of a browser storage area the store uses.
 * @typedef {object} StorageArea
 * @property {(key: string) => Promise<Record<string, any>>} get
 * @property {(items: Record<string, any>) => Promise<void>} set
 */
