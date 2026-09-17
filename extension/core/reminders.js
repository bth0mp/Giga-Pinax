const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const FORMATTERS = new Map();
const RESOLVED = new Map();
const CLAIM_RETRY_MS = 5 * 60 * 1000;

const fail = (code, message, path) => ({ ok: false, error: { code, message, ...(path ? { path } : {}) } });

function dateParts(value) {
  const match = typeof value === 'string' ? DATE.exec(value) : null;
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  const probe = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  return probe.getUTCFullYear() === parts[0] && probe.getUTCMonth() === parts[1] - 1 && probe.getUTCDate() === parts[2]
    ? parts : null;
}

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

export function resolveZonedDateTime(input) {
  if (!input || input.disambiguation !== 'reject') {
    return fail('invalid-disambiguation', 'Disambiguation must be reject.', 'disambiguation');
  }
  const date = dateParts(input.localDate);
  if (!date) return fail('invalid-date', 'Date must be an explicit real YYYY-MM-DD date.', 'localDate');
  if (!TIME.test(input.localTime)) return fail('invalid-time', 'Time must use HH:mm.', 'localTime');
  let format;
  try { format = formatter(input.timeZone); } catch {
    return fail('invalid-time-zone', 'Time zone must be a valid IANA identifier.', 'timeZone');
  }
  const cacheKey = `${input.localDate}|${input.localTime}|${input.timeZone}`;
  if (RESOLVED.has(cacheKey)) return structuredClone(RESOLVED.get(cacheKey));
  const unique = zonedCandidates(date, input.localTime, format).matches;
  let result;
  if (unique.length === 0) result = fail('nonexistent', 'That local time does not exist in this time zone.', 'localTime');
  else if (unique.length > 1) result = fail('ambiguous', 'That local time occurs more than once in this time zone.', 'localTime');
  else result = { ok: true, value: { startsAt: unique[0] } };
  if (RESOLVED.size >= 5000) RESOLVED.clear();
  RESOLVED.set(cacheKey, result);
  return structuredClone(result);
}

function addDays(localDate, amount) {
  const parts = dateParts(localDate);
  if (!parts) return null;
  const result = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + amount));
  return result.toISOString().slice(0, 10);
}

export function deriveReminderTriggers(events, _now) {
  const triggers = [];
  for (const event of events) {
    for (const reminder of event.reminders ?? []) {
      let triggerAt;
      if (reminder.kind === 'offset' && event.precision === 'timed') {
        triggerAt = new Date(Date.parse(event.startsAt) - reminder.offsetMinutes * 60000).toISOString();
      } else if (reminder.kind === 'wall-time' && event.precision === 'date-only') {
        const resolved = resolveZonedDateTime({
          localDate: addDays(event.localDate, -reminder.daysBefore),
          localTime: reminder.localTime,
          timeZone: event.timeZone,
          disambiguation: 'reject',
        });
        if (!resolved.ok) continue;
        triggerAt = resolved.value.startsAt;
      } else continue;
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

function relevanceEnd(trigger) {
  if (trigger.precision === 'timed') {
    return new Date(Date.parse(trigger.eventStartsAt) + 15 * 60000).toISOString();
  }
  const nextMidnight = startOfLocalDay(addDays(trigger.localDate, 1), trigger.timeZone);
  return nextMidnight ?? `${trigger.localDate}T23:59:59.999Z`;
}

function nextMillisecond(instant) {
  return new Date(Date.parse(instant) + 1).toISOString();
}

function earliest(current, candidate) {
  return current === null || candidate < current ? candidate : current;
}

export function reconcileScheduler(events, schedulerState, now) {
  const occurrences = new Map((schedulerState?.alerts ?? []).map((alert) => [alert.triggerId, alert]));
  const triggers = deriveReminderTriggers(events, now);
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
      const retryAt = new Date(Date.parse(occurrence.claimedAt) + CLAIM_RETRY_MS).toISOString();
      if (retryAt > now) {
        nextWakeAt = earliest(nextWakeAt, retryAt);
        continue;
      }
    }
    const effectiveAt = occurrence?.status === 'snoozed' && occurrence.snoozedUntil > now
      ? occurrence.snoozedUntil : trigger.triggerAt;
    if (effectiveAt > now) {
      nextWakeAt = earliest(nextWakeAt, effectiveAt);
      continue;
    }
    (overdueByEvent[trigger.eventId] ??= []).push(trigger);
    nextWakeAt = earliest(nextWakeAt, nextMillisecond(end));
  }
  return { nextWakeAt, overdueByEvent, missedTriggerIds };
}
