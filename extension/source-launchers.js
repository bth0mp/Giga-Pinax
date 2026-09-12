const ACCESS_UNAVAILABLE = Object.freeze({
  status: 'unavailable',
  label: 'Unavailable — access not approved',
});

export const SOURCE_CAPABILITIES = Object.freeze({
  coinarchives: Object.freeze({
    label: 'CoinArchives',
    launch: Object.freeze({
      transfer: 'verified',
      searchPageUrl: 'https://www.coinarchives.com/a/',
      route: Object.freeze({ origin: 'https://www.coinarchives.com', pathname: '/a/results.php' }),
    }),
    automaticEvidence: ACCESS_UNAVAILABLE,
  }),
  acsearch: Object.freeze({
    label: 'acsearch',
    launch: Object.freeze({
      transfer: 'verified',
      searchPageUrl: 'https://www.acsearch.info/',
      route: Object.freeze({ origin: 'https://www.acsearch.info', pathname: '/search.html' }),
    }),
    automaticEvidence: ACCESS_UNAVAILABLE,
  }),
});

const failure = (code, message, path) => ({
  ok: false,
  error: { code, message, ...(path === undefined ? {} : { path }) },
});

function validateQuery(query) {
  if (typeof query !== 'string') return null;
  if (/[\u0000-\u001f\u007f]/.test(query)) return null;
  const normalized = query.trim();
  if (!normalized || normalized.length > 400 || /^javascript:/i.test(normalized)) return null;
  return normalized;
}

export function buildUserInitiatedSearch(source, query) {
  if (!Object.hasOwn(SOURCE_CAPABILITIES, source)) {
    return failure('unsupported-source', 'Unknown research source.', 'source');
  }
  const capability = SOURCE_CAPABILITIES[source];
  const normalizedQuery = validateQuery(query);
  if (!normalizedQuery) return failure('invalid-query', 'Enter a query of 1 to 400 characters without control characters.', 'query');

  if (capability.launch.transfer !== 'verified') {
    return {
      ok: true,
      value: {
        source,
        query: normalizedQuery,
        url: capability.launch.searchPageUrl,
        transfer: 'unsupported',
        manualInstruction: 'Search page opened — paste query',
      },
    };
  }

  const { origin, pathname } = capability.launch.route;
  const url = new URL(pathname, origin);
  if (source === 'coinarchives') {
    url.searchParams.set('search', normalizedQuery);
    url.searchParams.set('s', '0');
  } else if (source === 'acsearch') {
    url.searchParams.set('term', normalizedQuery);
    url.searchParams.set('category', '1-2');
  }
  if (url.protocol !== 'https:' || url.origin !== origin || url.username || url.password) {
    return failure('unsafe-route', 'The reviewed source route is invalid.', 'source');
  }
  return {
    ok: true,
    value: { source, query: normalizedQuery, url: url.href, transfer: 'verified' },
  };
}
