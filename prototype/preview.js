"use strict";

// A visual fixture only: these are fictional amounts, not auction data or FX rates.
const sampleAmounts = [90, 110, 135, 165, 180, 215, 245, 310, 450];
const byId = (id) => document.getElementById(id);
const catalogue = byId("catalogue");
const currency = byId("currency");
const reference = byId("reference-number");
const form = byId("reference-form");
const results = byId("sample-results");
const error = byId("form-error");

try {
  const saved = localStorage.getItem("coin-lookup-preview-currency");
  if (["USD", "EUR", "GBP"].includes(saved)) currency.value = saved;
} catch { /* Preview also works when local storage is unavailable. */ }

function setScreen(screen) {
  byId("preview-state").value = screen;
  byId("welcome-screen").hidden = screen !== "welcome";
  byId("lookup-screen").hidden = screen !== "lookup";
  document.querySelector(".popup-scroll").scrollTop = 0;
}

function formatSamples() {
  const money = new Intl.NumberFormat("en-US", {
    style: "currency", currency: currency.value, maximumFractionDigits: 0,
  });
  byId("median-amount").textContent = money.format(180);
  byId("median-currency").textContent = currency.value;
  byId("range-amount").textContent = `${money.format(135)}–${money.format(245)}`;
  byId("sale-list").replaceChildren(...sampleAmounts.map((amount, index) => {
    const row = document.createElement("li");
    const label = document.createElement("span");
    const price = document.createElement("strong");
    label.textContent = `Illustrative sale ${String(index + 1).padStart(2, "0")}`;
    price.textContent = money.format(amount);
    row.append(label, price);
    return row;
  }));
}

function setCatalogue() {
  const isRic = catalogue.value === "RIC";
  byId("ric-fields").hidden = !isRic;
  byId("ric-volume").required = isRic;
  byId("ric-section").required = isRic;
  byId("reference-label").textContent = isRic ? "RIC number (including any suffix)" : "Price number";
  byId("reference-help").textContent = isRic ? "Example: RIC I (2nd edition), Nero 306" : "Example: Price 23 · Alexander III";
  reference.value = isRic ? "306" : "23";
  byId("result-reference").textContent = isRic ? "RIC I (2nd ed.) · NERO 306" : "PRICE 23";
  byId("result-type").textContent = isRic ? "Nero · Roman Imperial Coinage" : "Alexander III · Silver tetradrachm";
  const typeLink = byId("type-link");
  typeLink.href = isRic ? "https://numismatics.org/ocre/id/ric.1%282%29.ner.306" : "https://numismatics.org/pella/id/price.23";
  typeLink.setAttribute("aria-label", isRic ? "View Nero 306 type in OCRE, opens a new tab" : "View Price 23 type in PELLA, opens a new tab");
  error.hidden = true;
  results.hidden = false;
  byId("sale-details").open = false;
}

byId("preview-state").addEventListener("change", (event) => setScreen(event.target.value));
byId("preview-theme").addEventListener("change", (event) => {
  document.documentElement.dataset.theme = event.target.value;
});
byId("try-sample").addEventListener("click", () => {
  setScreen("lookup");
  reference.focus();
});
catalogue.addEventListener("change", setCatalogue);
currency.addEventListener("change", () => {
  formatSamples();
  try { localStorage.setItem("coin-lookup-preview-currency", currency.value); } catch { /* Optional preference. */ }
  byId("announcement").textContent = `Illustrative amounts now formatted in ${currency.value}; this is not a currency conversion.`;
});
form.addEventListener("input", (event) => {
  if (!["reference-number", "ric-volume", "ric-section"].includes(event.target.id)) return;
  // Hide the old sample as soon as its reference is changed.
  results.hidden = true;
  error.hidden = true;
});
form.addEventListener("submit", (event) => {
  event.preventDefault();
  const isRic = catalogue.value === "RIC";
  const validReference = reference.value.trim() === (isRic ? "306" : "23");
  const validRic = !isRic || (
    byId("ric-volume").value.trim().toLowerCase() === "i (2nd edition)" &&
    byId("ric-section").value.trim().toLowerCase() === "nero"
  );
  if (!validReference || !validRic) {
    results.hidden = true;
    error.textContent = isRic ? "This layout preview includes only RIC I (2nd edition), Nero 306. Live reference searches are not connected." : "This layout preview includes only Price 23. Live reference searches are not connected.";
    error.hidden = false;
    return;
  }
  error.hidden = true;
  results.hidden = false;
  byId("announcement").textContent = "Showing nine fictional sample sales. Median hammer 180, middle fifty percent 135 to 245, in the selected currency.";
});

formatSamples();
setCatalogue();
