# hia-vuedoc

`hia-vuedoc` is the HIA Vue Single File Component bridge workspace.

The first milestone focuses on a framework bridge, not a new core language standard:

- parse Vue SFC files with the official `@vue/compiler-sfc` package;
- keep Vue-specific facts in VueDoc extraction artifacts;
- bridge template symbols to HTMDoc-shaped artifacts;
- bridge style symbols to CSSDoc-shaped artifacts;
- preserve ordinary source map references for generated template/style outputs;
- emit `doc-source-map` and HIA core document artifacts for project aggregation.

## Source locations

The Vue bridge emits `doc-source-map@1.1.0` with a range convention on each
ranged source reference. Compiler SFC template annotations have measured
exclusive UTF-16 bounds. Script/style annotations, exposed API macro positions,
synthetic placeholders and external input remain explicitly unknown until their
coordinate behavior is verified. The HIA document and producer result identify
the emitted map version; disabling map output removes their map links.
Only annotations inside compiler-confirmed, nonempty template content receive
the measured template convention; empty or recovered spans stay unverified.
Annotation `source.offset` is zero-based UTF-16 within its compiler block content;
use the documentation source-map range for a file location.

The VueDoc runner accepts `options.emitCoordinateProfile: true` or `--coordinate-profile` to emit a separate `ordinary-source-map-coordinate-profile@0.1.0-draft` for a proven native template slot. This is disabled by default. Inline and preprocessed templates are rejected for this option; script and style source-map columns stay unverified. The sidecar alone does not grant source access or establish an exact anchor: the consuming host must check the two actual maps and authorized SFC bytes. See the producer package README for the precise input boundary.

## Fixture

```powershell
npm run release:gate
```

The fixture writes artifacts to `fixtures/doc-source-map/vue-sfc/dist/`.
