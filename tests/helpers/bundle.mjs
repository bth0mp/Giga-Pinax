// The bundled catalogue under extension/data, served to createLocalCatalogue as the package serves it. Shared by the files that test against the
// bundle itself, not the fixture: the sweeps over it are split across files so node runs them side by side. Each file parses the bundle once.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createLocalCatalogue } from '../../extension/local-catalogue.js';
import { findReferences, lotLookup } from '../../extension/lot.js';

export const BUNDLE = fileURLToPath(new URL('../../extension/data/', import.meta.url));
// The skip every bundle-backed test takes where the bundle is not checked out.
export const skip = existsSync(`${BUNDLE}ocre/index.json`) ? false : 'extension/data is not bundled here';
const files = new Map();
// A bundled file by its path under extension/data: "<corpus>/<name>", or a bare name for one the corpora share. Parsed once per file of tests.
export const bundleJson = (path) => {
  if (!files.has(path)) files.set(path, JSON.parse(readFileSync(`${BUNDLE}${path}`, 'utf8')));
  return files.get(path);
};
// The path under extension/data a catalogue's request is for.
export const bundlePath = (url) => decodeURIComponent(String(url)).replace('moz-extension://test/data/', '');
export const bundledLabels = () => bundleJson('nomisma-labels.json').labels;
// A catalogue served every file as the package serves it.
export const bundleCatalogue = () => createLocalCatalogue({
  baseUrl: 'moz-extension://test/data/',
  fetchImpl: async (url) => ({ ok: true, status: 200, json: async () => bundleJson(bundlePath(url)) }),
});
export const bundle = bundleCatalogue();

// A lot's first reference as the popup looks it up.
export const lotReference = (text) => {
  const found = findReferences(text);
  return lotLookup(found.references[0], found.rulers);
};

// The bundle's answer to a reference, asked once however many headings read as it: a lookup is a pure function of the reference and the files, so
// two spellings the lot reads alike ("Licinius" and "Licinius I") are one sweep, not two.
const answers = new Map();
export const answer = (reference) => {
  const key = JSON.stringify(reference);
  if (!answers.has(key)) answers.set(key, bundle.lookupType(reference));
  return answers.get(key);
};
// Every coin a reference opens on its own over RIC numbers 1 to 400, where reference(number) is the reference for that number, or null for none.
export async function openedOver(reference) {
  const opened = [];
  for (let number = 1; number <= 400; number += 1) {
    const asked = reference(number);
    if (!asked) continue;
    const result = await answer(asked);
    if (result?.status === 'ok') opened.push({ number, card: result.card });
  }
  return opened;
}
// Every coin a heading opens on its own over RIC numbers 1 to 400, read exactly as a pasted lot is read.
export const headingOpens = (heading) => openedOver((number) => {
  const lot = findReferences(`${heading}. RIC ${number}`);
  return lot.references[0] ? lotLookup(lot.references[0], lot.rulers) : null;
});

// The shard part a bundled OCRE id lives in.
const shardPartOf = (id) => {
  const parts = bundleJson('ocre/metadata.json').shards[String(id).split('.')[1]] ?? [];
  return parts.reduce((chosen, part) => (part.from <= id ? part : chosen), parts[0]);
};
const recordOf = (id) => bundleJson(`ocre/${shardPartOf(id)?.file}`)?.records?.[id];
// Who is on a coin, as the record itself says: its authorities and its obverse portraits. The card names neither where a type has two authorities
// (RIC V's joint reigns), and it is the record the person filter reads anyway.
export const peopleOn = (id) => {
  const record = recordOf(id);
  return [...(record?.a ?? []), ...(record?.o?.p ?? [])];
};
// Who the obverse portrays, as the record itself says: people, gods and personifications alike.
export const portraitsOn = (id) => recordOf(id)?.o?.p ?? [];
// Where a coin was struck, as the record itself says: the mint concepts the type carries.
export const mintsOn = (id) => recordOf(id)?.m ?? [];
