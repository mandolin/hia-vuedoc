# Fixtures

`doc-source-map/vue-sfc` is the first Vue SFC bridge fixture. It exercises a template block, a script setup block and a scoped style block.

Its generated `ProfileCard.docmap.json` uses `doc-source-map@1.1.0`. Template
annotation source ranges declare exclusive UTF-16 bounds; script, style and
macro branches retain `unknown` range conventions.
Annotation `source.offset` values are zero-based UTF-16 positions within compiler block content;
regenerating the fixture after the content-boundary fix updates those offsets
without changing `ProfileCard.docmap.json`.
