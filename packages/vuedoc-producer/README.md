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
- an optional body-free `ordinary-source-map-coordinate-profile@0.1.0-draft` sidecar for a proven native template source slot.

Set `options.emitCoordinateProfile: true` to request the sidecar. It is off by default and requires `emitDocSourceMap: true` and `sourcesContentPolicy: "none"`. The template content must begin on the line after the opening tag, use the native Vue template compiler, and produce one original SFC slot. Inline template content and preprocessed templates fail conservatively because their original columns are not proven by the current compiler mapping chain. Script and style maps remain unverified. The sidecar records digests of the actual ordinary map, documentation map and source bytes from the same build; it contains no source body. A strict reader must still check the current map bytes and authorized source bytes before reporting an exact anchor. Rebuilding the same input without the option removes its previous sidecar.

The existing producer-result artifact `kind` field is open, so an opt-in result may list the sidecar as a file artifact. The current project manifest does not consume this new kind or verify it automatically. Use the explicit `hia docs coordinate-verify` machine command with the sidecar, both maps and an authorized source file to request strict verification.

## Privacy

`sourcesContentPolicy` defaults to `none`. Public documentation builds should keep source content out of emitted artifacts unless a project explicitly opts into a reviewed embedding policy.

## License

MIT

# CSS extraction identity

CSS extraction artifact descriptors report the version of the actual emitted
bridge file (`hia-cssdoc-extraction@1.0.0` in current source). The artifact
profile is paired at `1.0.0`; Vue, HTML and documentation source-map identities
remain independently versioned.

中文：CSS清单身份与实际桥接文件一致，不将Vue/HTM或包版本一并改号。

