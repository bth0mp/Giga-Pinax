# RIC ruler lookup repair

The reported `RIC VII 287` coin is filed under Londinium. Its OCRE authority is Constantine I and its obverse portrait is Constantine II. The existing suggestions list book sections, so it omits people whose types occur in the mint-organised volumes VI–IX. Pasted `OCRE ric.7.lon.287` text also breaks citation extraction.

## Implementation

1. Generate a separate list of historical people from the bundled active authority and obverse-portrait identifiers, with verified English labels and alternate names from a single bounded Nomisma query. Preserve source provenance and reproducible generation; omit deities and personifications from ruler suggestions.
2. Combine people with the existing ruler/mint suggestions without changing RIC chapter tables. Recognise canonical names and supported aliases while preserving an explicitly chosen volume.
3. Filter local reference matches by authority or obverse portrait. Open only a verified unique match; present ambiguity and broadened matches honestly. Preserve mint, edition, suffix and replacement handling.
4. Parse the supplied lot description as RIC. Treat a strict OCRE identifier as a hint only after checking the cited volume, number, mint and person. Conflicting or multiple distinct hints cannot pick an unrelated coin.
5. Keep online fallback and independent auction-price research consistent with the same person intent. Add focused regression tests, have Astra review the design and implementation, and verify the original example in an isolated Brave extension.
6. Release 0.30.1 with updated installation instructions. Rebuild the existing installed folder so the user only needs to reload the extension. Verify both browser packages and public downloads.

Sol owns data and runtime implementation. The Astra reviewer checks design and code; the root coordinator handles integration verification and release. Source RDF remains unchanged; coverage describes people represented in this snapshot rather than claiming every historical ruler or perfectly corrected source records.

## Verification record

Implemented and Astra-reviewed on 2026-09-15. All 452 JavaScript and 23 Python tests pass without skips; Firefox lint reports zero errors, notices and warnings. An isolated native Brave extension verified the original lot, ruler/Latin aliases, ambiguous and conflicting references, explicit mint constraints, independent synthetic price curation and a 390-pixel dark layout. No ANS requests or application errors occurred. See [release notes](../../RELEASE-0.30.1.md) for the delivered scope and limits.
