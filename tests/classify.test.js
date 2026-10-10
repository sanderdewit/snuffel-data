// Run with:  node tests/classify.test.js
// Real-world-style names across Europe and the category each must get.
"use strict";
const assert = require("assert");
const { classify } = require("../lib/classify.js");

const vet = (name, extra) => Object.assign({ amenity: "veterinary", name }, extra);
const shop = (name) => ({ shop: "pet", name });
const park = (name) => ({ leisure: "park", name });

const cases = [
  // hospitals / emergency vets
  [vet("Tierklinik Hofheim"), "hospital"],
  [vet("Ospedale Veterinario I Portoni Rossi"), "hospital"],
  [vet("Dyrehospitalet i Aarhus"), "hospital"],
  [vet("Κτηνιατρικό Νοσοκομείο Αθηνών"), "hospital"],
  [vet("Állatorvosi Ügyelet"), "hospital"],
  [vet("Veterinarska bolnica Zagreb"), "hospital"],
  [vet("Przychodnia Weterynaryjna Całodobowa"), "hospital"],
  [vet("Clínica Veterinaria 24h"), "hospital"],
  [vet("Állatorvos 0–24"), "hospital"],
  [vet("Eläinsairaala Evidensia"), "hospital"],
  [vet("Klinika Weterynaryjna", { emergency: "yes" }), "hospital"],
  // ordinary vets stay vets
  [vet("Clinica Veterinaria San Marco"), "vet"],
  [vet("Dyreklinikken Aarhus"), "vet"],
  [vet("Veterinarska stanica Zagreb"), "vet"],
  [vet("Ветеринарна клініка Айболить"), "vet"],
  [vet("Державна лікарня ветеринарної медицини"), "vet"],   // state service, not an emergency hospital
  [vet("Veterinární klinika Brno"), "vet"],
  // grooming vs. shops
  [shop("Peluquería Canina Lola"), "grooming"],
  [shop("Toelettatura Bau Bau"), "grooming"],
  [shop("Kutyakozmetika Bodri"), "grooming"],
  [shop("Грумінг-салон Хвостик"), "grooming"],
  [shop("Zoo Shop Centrum"), "shop"],
  [{ shop: "pet_grooming", name: "Anything" }, "grooming"],
  // dog areas vs. ordinary parks
  [park("Area cani Parco Sempione"), "play"],
  [park("Parco Sempione"), null],
  [park("Hundeskov ved Søen"), "play"],
  [park("Kutyafuttató"), "play"],
  [park("Майданчик для собак"), "play"],
  [park("Pipicán Plaza Mayor"), "play"],
  [park("Psí louka Stromovka"), "play"],
  [{ leisure: "dog_park" }, "play"],
  // never: things that only share a word
  [{ amenity: "pharmacy", name: "Farmacia 24h" }, null],
  [{ amenity: "hospital", name: "Ziekenhuis Rijnstate" }, null],
  [{ amenity: "animal_training", animal_training: "horse", name: "Reitschule" }, null],
  [{ amenity: "animal_training", animal_training: "dog", name: "Hundeschule" }, "training"]
];

let passed = 0, failed = 0;
console.log("classification");
for (const [tags, want] of cases) {
  const got = classify(tags);
  try { assert.strictEqual(got, want); passed++; }
  catch (e) { failed++; console.log(`  FAIL ${JSON.stringify(tags)} -> ${got}, expected ${want}`); }
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
