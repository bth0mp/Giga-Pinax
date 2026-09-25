// @ts-check
import { dateParts, failure, isIsoInstant, shiftDate } from './validate.js';
/**
 * @typedef {import('./types.js').AuctionEvent} AuctionEvent
 * @typedef {import('./types.js').Alert} Alert
 * @typedef {import('./types.js').ReminderTrigger} ReminderTrigger
 * @typedef {import('./types.js').SchedulePlan} SchedulePlan
 */
/**
 * @template T
 * @typedef {import('./types.js').Result<T>} Result
 */

const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const FORMATTERS = new Map();
const RESOLVED = new Map();
const CLAIM_RETRY_MS = 5 * 60 * 1000;
// The last instant a record can hold. A relevance end or a wake time computed past it would be written "+010000-…",
// which is no instant a record may hold and which sorts before every ordinary one, so each is held to it instead.
const LAST_INSTANT = Date.parse('9999-12-31T23:59:59.999Z');
const instantAt = (milliseconds) => new Date(Math.min(milliseconds, LAST_INSTANT)).toISOString();

function formatter(timeZone) {
  if (FORMATTERS.has(timeZone)) return FORMATTERS.get(timeZone);
  const value = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23', numberingSystem: 'latn',
  });
  FORMATTERS.set(timeZone, value);
  return value;
}

function localParts(format, instant) {
  return Object.fromEntries(format.formatToParts(instant)
    .filter(({ type }) => ['year', 'month', 'day', 'hour', 'minute', 'second'].includes(type))
    .map(({ type, value }) => [type, Number(value)]));
}

/**
 * @param {string} timeZone
 * @param {string | number} instant
 * @returns {string}
 */
export function localDateAtInstant(timeZone, instant) {
  const parts = localParts(formatter(timeZone), new Date(instant));
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

function zonedCandidates(date, localTime, format) {
  const [hour, minute] = localTime.split(':').map(Number);
  const target = { year: date[0], month: date[1], day: date[2], hour, minute, second: 0 };
  const center = Date.UTC(date[0], date[1] - 1, date[2], hour, minute);
  const offsets = new Set();
  for (const days of [-2, -1, 0, 1, 2]) {
    const probe = center + days * 86400000;
    const parts = localParts(format, new Date(probe));
    const representedAsUtc = Date.UTC(
      parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second,
    );
    offsets.add(representedAsUtc - probe);
  }
  const all = [];
  const matches = [];
  for (const offset of offsets) {
    const instant = new Date(center - offset);
    const parts = localParts(format, instant);
    all.push(instant.toISOString());
    if (Object.keys(target).every((key) => parts[key] === target[key])) matches.push(instant.toISOString());
  }
  return { matches: [...new Set(matches)].sort(), all: [...new Set(all)].sort() };
}

/**
 * The one instant a local date and time name in a zone, or a failure where the time does not exist or
 * occurs twice there.
 * @param {{ localDate: *, localTime: *, timeZone: *, disambiguation: 'reject' }} input
 * @returns {Result<{ startsAt: string }>}
 */
export function resolveZonedDateTime(input) {
  if (!input || input.disambiguation !== 'reject') {
    return failure('invalid-disambiguation', 'Disambiguation must be reject.', 'disambiguation');
  }
  const date = dateParts(input.localDate);
  if (!date) return failure('invalid-date', 'Date must be an explicit real YYYY-MM-DD date.', 'localDate');
  if (!TIME.test(input.localTime)) return failure('invalid-time', 'Time must use HH:mm.', 'localTime');
  let format;
  try { format = formatter(input.timeZone); } catch {
    return failure('invalid-time-zone', 'Time zone must be a valid IANA identifier.', 'timeZone');
  }
  const cacheKey = `${input.localDate}|${input.localTime}|${input.timeZone}`;
  if (RESOLVED.has(cacheKey)) return structuredClone(RESOLVED.get(cacheKey));
  const unique = zonedCandidates(date, input.localTime, format).matches;
  /** @type {Result<{ startsAt: string }>} */
  let result;
  if (unique.length === 0) result = failure('nonexistent', 'That local time does not exist in this time zone.', 'localTime');
  else if (unique.length > 1) result = failure('ambiguous', 'That local time occurs more than once in this time zone.', 'localTime');
  else result = { ok: true, value: { startsAt: unique[0] } };
  if (RESOLVED.size >= 5000) RESOLVED.clear();
  RESOLVED.set(cacheKey, result);
  return structuredClone(result);
}

/**
 * @param {AuctionEvent[]} events
 * @param {string} [_now]
 * @returns {ReminderTrigger[]}
 */
export function deriveReminderTriggers(events, _now) {
  const triggers = [];
  for (const event of events) {
    for (const reminder of event.reminders ?? []) {
      let triggerAt;
      if (reminder.kind === 'offset' && event.precision === 'timed') {
        triggerAt = new Date(Date.parse(event.startsAt) - reminder.offsetMinutes * 60000).toISOString();
      } else if (reminder.kind === 'wall-time' && event.precision === 'date-only' && reminder.collectorTimeZone !== undefined) {
        triggerAt = ringOnCollectorClock(event, reminder);
        if (triggerAt === null) continue;
      } else if (reminder.kind === 'wall-time' && event.precision === 'date-only') {
        const resolved = resolveZonedDateTime({
          localDate: shiftDate(event.localDate, -reminder.daysBefore),
          localTime: reminder.localTime,
          timeZone: event.timeZone,
          disambiguation: 'reject',
        });
        if (!resolved.ok) continue;
        triggerAt = resolved.value.startsAt;
      } else continue;
      // An offset taken off a date near the start of the era lands outside the years an ISO instant can spell, and the
      // expanded form Date gives back is no timestamp an alert may hold. Skipped like an unresolvable wall time: one
      // reminder is lost rather than every reminder in the store, which is what a snapshot that cannot validate costs.
      if (!isIsoInstant(triggerAt)) continue;
      triggers.push({
        // The identity deliberately excludes the event revision: editing an event must not
        // discard the acknowledgements and snoozes the collector already gave its reminders.
        id: `${event.id}:${reminder.id}:${triggerAt}`,
        eventId: event.id,
        eventRevision: event.revision,
        reminderId: reminder.id,
        triggerAt,
        eventName: event.name,
        precision: event.precision,
        eventStartsAt: event.startsAt,
        localDate: event.localDate,
        timeZone: event.timeZone,
      });
    }
  }
  return triggers.sort((left, right) => left.triggerAt.localeCompare(right.triggerAt));
}

function startOfLocalDay(localDate, timeZone) {
  const date = dateParts(localDate);
  if (!date) return null;
  let format;
  try { format = formatter(timeZone); } catch { return null; }
  const { matches, all } = zonedCandidates(date, '00:00', format);
  // A local midnight that does not exist or happens twice still ends the day before it. Taking
  // the later instant keeps an evening reminder deliverable in the zones that change at midnight.
  return (matches.length ? matches : all).at(-1) ?? null;
}

const RINGS = new Map();
// The collector's waking hours, for a day whose own reminder time falls nowhere inside it.
const WAKING = ['08:00', '21:00'];

/**
 * When a date-only reminder saved with the collector's zone goes off (Q-19, the lead's rule). Its day is the sale day
 * `daysBefore` days back, in the auction's zone: from that day's start to its end. It rings at its own time (09:00) on
 * the collector's clock, on the latest of their days where that time falls inside the day. Where none does (a day of 23
 * hours can miss it), it rings at the latest minute inside the day between 08:00 and 21:00 on their clock, and where no
 * minute is, or their zone cannot be read, at the day's start. So it is never after the day ends where the auction is,
 * nor before it starts. Null where the day itself cannot be placed.
 * @param {AuctionEvent} event
 * @param {import('./types.js').WallTimeReminder} reminder
 * @returns {string | null}
 */
function ringOnCollectorClock(event, reminder) {
  const cacheKey = `${event.localDate}|${reminder.daysBefore}|${reminder.localTime}|${event.timeZone}|${reminder.collectorTimeZone}`;
  if (RINGS.has(cacheKey)) return RINGS.get(cacheKey);
  const day = shiftDate(event.localDate, -reminder.daysBefore);
  const start = day === null ? null : startOfLocalDay(day, event.timeZone);
  const end = start === null ? null : startOfLocalDay(/** @type {string} */ (shiftDate(/** @type {string} */ (day), 1)), event.timeZone);
  let ring = null;
  if (start !== null && end !== null && TIME.test(reminder.localTime)) {
    ring = start;
    let format = null;
    try { format = formatter(reminder.collectorTimeZone); } catch { /* the day's start */ }
    // The collector's days that can reach into the auction's: zones are at most 26 hours apart.
    const dates = format ? [-2, -1, 0, 1, 2].map((days) => dateParts(shiftDate(day, days))).filter((date) => date !== null) : [];
    const own = dates.flatMap((date) => zonedCandidates(date, reminder.localTime, format).matches)
      .filter((instant) => instant >= start && instant < end).sort().at(-1);
    if (own) ring = own;
    else {
      const lastMinute = instantAt(Date.parse(end) - 60000);
      let latest = null;
      for (const date of dates) {
        const opens = zonedCandidates(date, WAKING[0], format);
        const closes = zonedCandidates(date, WAKING[1], format);
        const from = opens.matches[0] ?? opens.all.at(-1);
        const until = closes.matches.at(-1) ?? closes.all[0];
        if (!from || !until) continue;
        const last = until < lastMinute ? until : lastMinute;
        if (last >= from && last >= start && (latest === null || last > latest)) latest = last;
      }
      if (latest !== null) ring = latest;
    }
  }
  if (RINGS.size >= 5000) RINGS.clear();
  RINGS.set(cacheKey, ring);
  return ring;
}

function relevanceEnd(trigger) {
  if (trigger.precision === 'timed') {
    return instantAt(Date.parse(trigger.eventStartsAt) + 15 * 60000);
  }
  const nextMidnight = startOfLocalDay(shiftDate(trigger.localDate, 1), trigger.timeZone);
  return nextMidnight ?? `${trigger.localDate}T23:59:59.999Z`;
}

function nextMillisecond(instant) {
  return instantAt(Date.parse(instant) + 1);
}

function earliest(current, candidate) {
  return current === null || candidate < current ? candidate : current;
}

// The name a browser resolves a zone to (Etc/UTC and UTC are both UTC), or the name as written where it knows none.
function resolvedZone(timeZone) {
  try { return new Intl.DateTimeFormat('en', { timeZone }).resolvedOptions().timeZone; } catch { return String(timeZone ?? ''); }
}

/**
 * A time zone as a collector names it: the place in its IANA name (`Europe/London` is `London`, `America/New_York`
 * is `New York`). UTC is `UTC`. An `Etc/` zone has no place and a fixed offset, and its id's sign is the other way
 * round (`Etc/GMT+5` is five hours behind), so it reads as the offset: `GMT-5`. Any other name keeps its id.
 * @param {*} timeZone
 * @returns {string}
 */
export function zonePlace(timeZone) {
  const zone = String(timeZone ?? '');
  if (/^(?:Etc\/)?(?:UTC|UCT|GMT|Zulu|Universal)$/.test(zone) || (zone && resolvedZone(zone) === 'UTC')) return 'UTC';
  if (zone.startsWith('Etc/')) {
    try {
      return new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'shortOffset' }).formatToParts(0)
        .find(({ type }) => type === 'timeZoneName')?.value ?? zone;
    } catch { return zone; }
  }
  if (!zone.includes('/')) return zone;
  return zone.slice(zone.lastIndexOf('/') + 1).replaceAll('_', ' ');
}

/**
 * Whether two zone names are one zone as the browser knows them: `UTC` and `Etc/UTC` are, `Europe/London` and
 * `Europe/Dublin` are not. A name the browser does not know is compared as it is written.
 * @param {*} left
 * @param {*} right
 * @returns {boolean}
 */
export function sameZone(left, right) {
  return left === right || resolvedZone(left) === resolvedZone(right);
}

const NOTICE_VERB = { 'lot-closes': 'Closes', 'auction-starts': 'Starts', 'auction-day': 'Sale day' };

// A date or a time in the collector's language, or the ISO text the record holds where the language or zone cannot be used.
function formatIn(locale, timeZone, options, instant, fallback) {
  try { return new Intl.DateTimeFormat(locale, { ...options, timeZone }).format(new Date(instant)); } catch { return fallback; }
}
const dayIn = (locale, timeZone, instant, fallback) => formatIn(locale, timeZone, { weekday: 'short', day: 'numeric', month: 'short' }, instant, fallback);
const timeIn = (locale, timeZone, instant, fallback) => formatIn(locale, timeZone, { hour: 'numeric', minute: '2-digit' }, instant, fallback);
function dateIn(timeZone, instant) {
  try { return localDateAtInstant(timeZone, instant); } catch { return String(instant).slice(0, 10); }
}

/**
 * The words of a reminder's desktop notification, the collector's clock first so a banner that cuts the text keeps it.
 * A timed auction: `Closes Fri 16 Oct, 8:00 your time — 14:00 Zurich`. A date-only sale day is a calendar day in the
 * auction's zone; its reminder goes off at a wall time on your clock (`Sale day Fri 2 Oct — Thu 1 Oct 9:00 your time,
 * 14:00 London`) or, saved before Q-19, at one there (`… Thu 1 Oct 10:00 your time, 9:00 London`). Your day is named where it is not the sale day (or, for a timed auction, always), the auction's where it
 * is not yours; the auction's clock and place only where its zone is not yours and the browser can read it. Nothing
 * here moves when a reminder goes off.
 * @param {ReminderTrigger} trigger
 * @param {{ eventKind?: string, timeZone: string, locale?: string }} view the auction's kind, and the collector's zone and language
 * @returns {string}
 */
export function reminderNotice(trigger, { eventKind, timeZone: viewerZone, locale }) {
  const zone = trigger.timeZone;
  const verb = NOTICE_VERB[String(eventKind)] ?? 'Auction';
  // The auction's side of one instant: its day where that is not the collector's, its time and its place.
  const theirs = (instant) => {
    if (sameZone(zone, viewerZone)) return '';
    const time = timeIn(locale, zone, instant, '');
    if (!time) return '';
    const day = dateIn(zone, instant) === dateIn(viewerZone, instant) ? '' : `${dayIn(locale, zone, instant, '')} `;
    return `${day}${time} ${zonePlace(zone)}`;
  };
  const yourTime = (instant) => `${timeIn(locale, viewerZone, instant, String(instant).slice(11, 16))} your time`;
  if (trigger.precision === 'timed' && Number.isFinite(Date.parse(String(trigger.eventStartsAt)))) {
    const starts = /** @type {string} */ (trigger.eventStartsAt);
    const there = theirs(starts);
    return `${verb} ${dayIn(locale, viewerZone, starts, trigger.localDate)}, ${yourTime(starts)}${there ? ` — ${there}` : ''}`;
  }
  const saleDay = dayIn(locale, 'UTC', `${trigger.localDate}T12:00:00Z`, trigger.localDate);
  const at = trigger.triggerAt;
  const yourDay = dateIn(viewerZone, at) === trigger.localDate ? '' : `${dayIn(locale, viewerZone, at, at.slice(0, 10))} `;
  const there = theirs(at);
  return `${verb} ${saleDay} — ${yourDay}${yourTime(at)}${there ? `, ${there}` : ''}`;
}

/**
 * @param {AuctionEvent[]} events
 * @param {{ alerts?: Alert[] } | null | undefined} schedulerState
 * @param {string} now
 * @returns {SchedulePlan}
 */
export function reconcileScheduler(events, schedulerState, now) {
  const occurrences = new Map((schedulerState?.alerts ?? []).map((alert) => [alert.triggerId, alert]));
  const triggers = deriveReminderTriggers(events, now);
  /** @type {Record<string, ReminderTrigger[]>} */
  const overdueByEvent = {};
  const missedTriggerIds = [];
  let nextWakeAt = null;
  for (const trigger of triggers) {
    const occurrence = occurrences.get(trigger.id);
    if (occurrence?.status === 'acknowledged' || occurrence?.status === 'delivered' || occurrence?.status === 'missed') continue;
    const end = relevanceEnd(trigger);
    if (now > end) {
      missedTriggerIds.push(trigger.id);
      continue;
    }
    if (occurrence?.status === 'claimed') {
      // A claimed alert carries its claim time, and a snoozed one its end (records.js alertResult).
      const retryAt = instantAt(Date.parse(/** @type {string} */ (occurrence.claimedAt)) + CLAIM_RETRY_MS);
      if (retryAt > now) {
        nextWakeAt = earliest(nextWakeAt, retryAt);
        continue;
      }
    }
    const effectiveAt = occurrence?.status === 'snoozed' && /** @type {string} */ (occurrence.snoozedUntil) > now
      ? /** @type {string} */ (occurrence.snoozedUntil) : trigger.triggerAt;
    if (effectiveAt > now) {
      nextWakeAt = earliest(nextWakeAt, effectiveAt);
      continue;
    }
    (overdueByEvent[trigger.eventId] ??= []).push(trigger);
    nextWakeAt = earliest(nextWakeAt, nextMillisecond(end));
  }
  return { nextWakeAt, overdueByEvent, missedTriggerIds };
}
