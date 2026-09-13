const GROUPS = Object.freeze([
  ['acsearch', [['Sign in','https://www.acsearch.info/login.html'],['Search','https://www.acsearch.info/search.html']]],
  ['CoinArchives free', [['Ancient coins','https://www.coinarchives.com/a/'],['World coins','https://www.coinarchives.com/w/']]],
  ['CoinArchives Pro', [['Sign in','https://pro.coinarchives.com/login.php'],['Ancient coins','https://pro.coinarchives.com/a/'],['World coins','https://pro.coinarchives.com/w/']]],
]);

export function mountSourcesMenu(container) {
  if (!container?.replaceChildren) throw new TypeError('Sources container is required.');
  const details = document.createElement('details');
  details.className = 'sources-menu';
  const summary = document.createElement('summary');
  summary.textContent = 'Sources';
  details.append(summary);
  const body = document.createElement('div');
  body.className = 'sources-menu-body';
  for (const [name, links] of GROUPS) {
    const group = document.createElement('div');
    group.className = 'sources-menu-group';
    const heading = document.createElement('strong');
    heading.textContent = name;
    const row = document.createElement('div');
    row.className = 'sources-menu-links';
    for (const [label, href] of links) {
      const link = document.createElement('a');
      link.textContent = label;
      link.href = href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      row.append(link);
    }
    group.append(heading, row);
    body.append(group);
  }
  details.append(body);
  const closeOnEscape = (event) => { if (event.key === 'Escape' && details.open) { details.open = false; summary.focus(); } };
  details.addEventListener('keydown', closeOnEscape);
  container.replaceChildren(details);
  return { destroy() { details.removeEventListener('keydown', closeOnEscape); container.replaceChildren(); } };
}
