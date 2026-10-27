# @hia-doc/vuedoc-runner

Standalone VueDoc runner for Vue SFC documentation artifacts.

```json
{
  "contract": "hia-vuedoc-runner-config",
  "contractVersion": "0.1.0-draft",
  "workspaceRoot": ".",
  "outputDirectory": "dist/hia-vuedoc",
  "inputs": [
    {
      "kind": "vue-sfc",
      "path": "src/components/ProfileCard.vue",
      "language": "vue"
    }
  ],
  "options": {
    "emitDocSourceMap": true,
    "sourcesContentPolicy": "none",
    "writeResultManifest": true
  }
}
```

```bash
npx hia-vuedoc --config hia-vuedoc.config.json
```

The runner emits VueDoc, HTMDoc, CSSDoc, HIA document and doc-source-map artifacts through `@hia-doc/vuedoc-producer`.

Set `options.emitCoordinateProfile: true` or pass `--coordinate-profile` for an optional body-free template coordinate sidecar. It is disabled by default, requires `emitDocSourceMap: true` and `sourcesContentPolicy: "none"`, and conservatively rejects inline or preprocessed templates. The script and style maps remain unverified. A host must independently check both map files and authorized source bytes with the strict coordinate reader before claiming an exact anchor.

The producer result can list the sidecar as an artifact because its artifact-kind field is open. The current project manifest does not consume this kind; use `hia docs coordinate-verify` explicitly.
