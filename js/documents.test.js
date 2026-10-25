import assert from "node:assert/strict";
import test from "node:test";
import { limitPresentationSections } from "./documents.js";

test("presentation slide limit preserves an ending section and reserves the cover", () => {
  const sections = [
    { title: "Pembuka" },
    { title: "Lokasi" },
    { title: "Keanekaragaman" },
    { title: "Dampak" },
    { title: "Kesimpulan" },
  ];

  const result = limitPresentationSections(sections, 5);

  assert.equal(result.length, 4);
  assert.deepEqual(result.map((section) => section.title), [
    "Pembuka",
    "Lokasi",
    "Keanekaragaman",
    "Kesimpulan",
  ]);
});

test("presentation slide limit does not add empty content slides", () => {
  const sections = [{ title: "Isi" }];

  assert.deepEqual(limitPresentationSections(sections, 5), sections);
  assert.deepEqual(limitPresentationSections(sections, 1), []);
  assert.deepEqual(limitPresentationSections(sections, null), sections);
});

test("structured presentation slide limits count the supplied title slide, without adding a duplicate cover", () => {
  const slides = [
    { title: "Sampul", points: ["Judul"] },
    { title: "Manfaat", points: ["Manfaat satu", "Manfaat dua", "Manfaat tiga"] },
    { title: "Penutup dan Call to Action", points: ["Mulai sekarang"] },
  ];
  assert.deepEqual(limitPresentationSections(slides, 3, false), slides);
});
