# @hia-doc/vuedoc-producer

Documentation producer adapter for Vue Single File Component artifacts in the HIA documentation toolchain.

`@hia-doc/vuedoc-producer` consumes Vue SFC inputs, extracts Vue component documentation, bridges template/style facts into HTMDoc and CSSDoc-shaped artifacts, emits an HIA document, and can produce a `doc-source-map` manifest for source-linked project aggregation.

## Install

```bash
npm install --save-dev @hia-doc/vuedoc-producer
```

This package is normally used through `@hia-doc/vuedoc-runner` or a HIA project manifest producer pipeline.

## Usage

```js
import { vuedocProducer } from "@hia-doc/vuedoc-producer";

const result = await vuedocProducer.produce({
  workspaceRoot: process.cwd(),
  outputDirectory: "dist/hia-vuedoc",
  inputs: [
    {
      kind: "vue-sfc",
      path: "src/components/ProfileCard.vue",
      language: "vue"
    }
  ],
  options: {
    emitDocSourceMap: true,
    sourcesContentPolicy: "none",
    writeResultManifest: true
  }
});
```

## Outputs

The producer can emit:

- VueDoc extraction artifacts;
- HTMDoc-shaped template artifacts;
- CSSDoc-shaped style artifacts;
- generated JavaScript and CSS references;
- ordinary source maps when produced by the Vue compiler;
- HIA document artifacts;
- `doc-source-map` manifests.

## Privacy

`sourcesContentPolicy` defaults to `none`. Public documentation builds should keep source content out of emitted artifacts unless a project explicitly opts into a reviewed embedding policy.

## License

MIT

