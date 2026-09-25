// @ts-check
// The popup's fixed words (popup.js): what it says when a lookup, a price search or a copy cannot go
// ahead, and the site addresses it falls back to.
import { catalogueForCorpus } from './catalogues.js';

const CONNECTION_MESSAGE = 'Couldn’t connect to numismatics.org. Try the catalogue lookup again later. You can still search auction results below.';
const CONNECTION_ONLY_MESSAGE = 'Couldn’t connect to numismatics.org. Try the catalogue lookup again later.';
const BARE_RIC_HINT = 'Type a ruler or volume to search auction results.';
const PERMISSION_MESSAGE = 'Giga Pinax needs permission to contact numismatics.org and nomisma.org to look up types. Select “Look up” again to allow it.';
const ACSEARCH_NETWORK_MESSAGE = 'Couldn’t reach acsearch. Check your connection and try again.';
const ACSEARCH_TOO_LARGE_MESSAGE = 'acsearch sent a reply too large to read, so no prices are shown. Try a narrower search term.';
const ACSEARCH_PERMISSION_MESSAGE = 'Giga Pinax needs permission to contact acsearch.info to fetch prices. Select “Get prices” again to allow it.';
// K-11: a newcomer does not know that acsearch is a subscription archive, nor that the CoinArchives block below is free and needs no account.
const SIGN_IN_MESSAGE = 'Hammer prices come from acsearch.info, which shows them to subscribers who are signed in. Select “Get CoinArchives prices” below for free public results, or sign in to acsearch and select “Get prices”:';
// X-17: every price on the page is acsearch's "*", which it shows a visitor who is not signed in and every lot not sold yet.
const hiddenPricesMessage = (upcoming) => `Every price on this page is hidden (*). If you are signed out of acsearch, sign in and select “Get prices”${upcoming ? '; lots not yet sold are listed below' : ''}.`;
// X-10: a card drawn while nomisma.org did not answer shows the names that came back and says the rest are missing, never their identifiers.
const NAMES_UNAVAILABLE = 'names unavailable — nomisma.org didn’t answer';
// X-04: a first edition's number is answered before any request, in words, since no catalogue here or online holds those numbers.
/**
 * @param {{ number: string, book: string }} citation
 * @param {boolean} searched
 * @returns {string}
 */
const firstEditionMessage = ({ number, book }, searched) => `${book || 'RIC'} ${number} is cited from the first edition${book ? ` of ${book}` : ''}. `
  + (book ? 'The catalogue here and OCRE use the second edition, whose numbers differ, so no type is opened.'
    : 'The catalogue here and OCRE hold RIC I, II.1 and II.3 in their second edition only, whose numbers differ, so no type is opened.')
  + (searched ? ' Auction results are searched by the number as written.' : ` ${BARE_RIC_HINT}`);
const ACCESS_HINT = 'Select “Get prices” to let Giga Pinax fetch acsearch prices.';
const EMPTY_TERM_MESSAGE = 'Enter a search term for acsearch, such as “Nero 306”.';
const ACSEARCH_HOME = 'https://www.acsearch.info/';
const COINARCHIVES_ORIGIN = 'https://www.coinarchives.com/*';
const COINARCHIVES_HOME = 'https://www.coinarchives.com/';
const EMPTY_OTHER_MESSAGE = 'Enter a reference, such as “BCD Boiotia 174b”.';
const COPY_FAILED_MESSAGE = 'Couldn’t copy the summary.';
// The references the first popup offers as chips, before anything has been looked up: one of each kind the box reads most, all bundled.
const EXAMPLE_REFERENCES = Object.freeze(['RIC I² Nero 306', 'Crawford 44/5', 'Price 23']);
const QUICK_ERROR = 'Couldn’t read that reference. Try “RIC 972”, “Titus 123”, “Crawford 44/5”, “SC 1266.2”, “Bop Euthydemus I 24A” or “Price 23”, or use the fields below.';
const OTHER_SUMMARY = 'No open type data for this reference. Prices from acsearch only.';
const CHECK_MESSAGE = 'Enter an amount such as 500.';
const NO_REFERENCES_MESSAGE = 'No catalogue references found in that text.';
const EMPTY_QUICK_MESSAGE = 'Type a reference in the Reference box, such as “RIC 972”.';
// K-02: what the box says to text that names no catalogue. Words are offered as an acsearch search the collector starts himself; a ruler the people
// table knows opens Refine reference with him filled in; a web address is refused, since a lot page is captured, never searched as text.
const NO_CATALOGUE_MESSAGE = 'No catalogue reference in that text.';
const rulerMessage = (ruler) => `${ruler} is a RIC ruler. Add the type’s number under Refine reference, or search acsearch for the words.`;
const WEB_ADDRESS_MESSAGE = 'That’s a web address. Open the page in a tab, then use “Capture the lot page you’re on” below.';
const SPELLINGS_HINT = 'The box also reads “RIC 972”, “Titus 123”, “SC 1266.2” and “Bop Euthydemus I 24A”, or use Refine reference.';
const PRICES_WAIT_MESSAGE = 'This reference names more than one type, so no prices are shown. Choose one type to see its prices.';
// Names the bundle that was really searched: every bundled corpus takes this path now, and a collector told his Price
// number is not in OCRE would be told about a catalogue nobody looked in.
// @ts-expect-error -- catalogueForCorpus answers a union in which Other has no corpusName, or null for no corpus; the
// optional chain reads undefined for both and the ternary only reads the name again when there is one.
const onlineMessage = (corpus) => `This type was not available in the local ${catalogueForCorpus(corpus)?.corpusName ? `${catalogueForCorpus(corpus).corpusName} ` : ''}catalogue. `
  + 'Check online to search numismatics.org.';

// A bare RIC number starts no auction search of its own (namesOneType), so where there is none below, the message says what would start one.
// X-04: where the bundle had already answered that it does not hold the reference (bundled names the book it checked), the failed request is only
// the further look online, and the message says so first: the connection is not the reason there is no card.
/**
 * @param {{ status: string, httpStatus?: number }} outcome
 * @param {boolean} hasFallback
 * @param {boolean} [bareRic]
 * @param {string} [bundled]
 * @returns {string}
 */
function catalogueFailureMessage(outcome, hasFallback, bareRic = false, bundled = '') {
  const searches = hasFallback ? ' You can still search auction results below.' : bareRic ? ` ${BARE_RIC_HINT}` : '';
  if (bundled) {
    const further = outcome.status === 'unavailable' ? `numismatics.org is temporarily unavailable (HTTP ${outcome.httpStatus}), so nothing further was checked.`
      : outcome.status === 'rate-limited' ? `numismatics.org is temporarily limiting requests (HTTP ${outcome.httpStatus}), so nothing further was checked.`
        : 'numismatics.org couldn’t be reached to look further.';
    return `Not in the bundled ${bundled} (checked offline). ${further}${searches}`;
  }
  if (outcome.status === 'unavailable') return `numismatics.org is temporarily unavailable (HTTP ${outcome.httpStatus}). Try the catalogue lookup again later.${searches}`;
  if (outcome.status === 'rate-limited') return `numismatics.org is temporarily limiting requests (HTTP ${outcome.httpStatus}). Try the catalogue lookup again later.${searches}`;
  return hasFallback ? CONNECTION_MESSAGE : `${CONNECTION_ONLY_MESSAGE}${searches}`;
}

/**
 * @param {*} outcome
 * @param {string} currency
 * @returns {string}
 */
function coinArchivesFailure(outcome, currency) {
  if (outcome.status === 'empty') return `CoinArchives returned no public results for “${outcome.term}”.`;
  if (outcome.status === 'closest') return `CoinArchives showed a different closest search instead of “${outcome.term}”. Open the results to review it.`;
  if (outcome.status === 'no-currency') {
    const available = Object.entries(outcome.availableCurrencyCounts ?? {}).map(([code, count]) => `${count} ${code}`).join(', ');
    return `No completed public sales in ${currency}.${available ? ` Available without conversion: ${available}.` : ''}`;
  }
  if (outcome.status === 'unpriced') return 'CoinArchives returned public results, but no completed sales with a recorded hammer price.';
  if (outcome.status === 'layout') return 'CoinArchives results could not be read. Open the public results to review them.';
  return 'Couldn’t reach CoinArchives. Check your connection and try again.';
}

export {
  ACCESS_HINT, ACSEARCH_HOME, ACSEARCH_NETWORK_MESSAGE, ACSEARCH_PERMISSION_MESSAGE, ACSEARCH_TOO_LARGE_MESSAGE, CHECK_MESSAGE,
  COINARCHIVES_HOME, COINARCHIVES_ORIGIN, COPY_FAILED_MESSAGE, EMPTY_OTHER_MESSAGE, EMPTY_QUICK_MESSAGE, EMPTY_TERM_MESSAGE, EXAMPLE_REFERENCES,
  NO_CATALOGUE_MESSAGE, NO_REFERENCES_MESSAGE, OTHER_SUMMARY, PERMISSION_MESSAGE, PRICES_WAIT_MESSAGE, QUICK_ERROR, SIGN_IN_MESSAGE, SPELLINGS_HINT,
  NAMES_UNAVAILABLE, WEB_ADDRESS_MESSAGE, catalogueFailureMessage, firstEditionMessage, coinArchivesFailure, hiddenPricesMessage, onlineMessage, rulerMessage,
};
