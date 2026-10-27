# @hia-doc/vue-sfc-doc-source-map

Creates `doc-source-map@1.1.0` manifests for Vue SFC bridge outputs.

Each source reference with a range includes `rangeConvention`. The measured
`@vue/compiler-sfc` template annotation branch uses an exclusive end and
UTF-16 code-unit columns. Script and style annotations, `defineExpose` macro
positions, synthetic component placeholders, parser-error paths and external
adapters use `unknown` for both fields. Source mechanisms use the shared
`parser` / `heuristic` / `adapter` categories while `rangeSourceDetail` retains
the Vue-specific origin. Unknown ranges have `low` or `none` confidence and
remain source relations rather than exact cursor positions.

The writer registers its Vue source and only links generated artifacts that
were provided. The current chain accepts one Vue source file;
symbols pointing to another file are rejected until a multi-source chain is
defined. Ordinary source maps reference the matching generated artifact
through `mapsFrom`. Source bodies are not embedded.
