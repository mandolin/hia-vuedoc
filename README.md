# hia-vuedoc

`hia-vuedoc` is the HIA Vue Single File Component bridge workspace.

The first milestone focuses on a framework bridge, not a new core language standard:

- parse Vue SFC files with the official `@vue/compiler-sfc` package;
- keep Vue-specific facts in VueDoc extraction artifacts;
- bridge template symbols to HTMDoc-shaped artifacts;
- bridge style symbols to CSSDoc-shaped artifacts;
- preserve ordinary source map references for generated template/style outputs;
- emit `doc-source-map` and HIA core document artifacts for project aggregation.

## Status

This workspace is an early spike for W-P12.4. It is intentionally smaller than the mature `hia-pugdoc` and `hia-tsdoc` workspaces.

## Fixture

```powershell
npm run release:gate
```

The fixture writes artifacts to `fixtures/doc-source-map/vue-sfc/dist/`.
