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
