import { VUEDOC_EXTRACTION_CONTRACT } from "@hia-doc/vuedoc-spec";

export function createVueSfcDocSourceMap(options) {
  const {
    vueArtifact,
    vueDocPath,
    htmDocPath,
    cssDocPath,
    hiaDocumentPath,
    templatePath,
    templateMapPath,
    scriptPath,
    scriptMapPath,
    stylePath,
    styleMapPath
  } = options ?? {};

  assertVueDocArtifact(vueArtifact);
  const normalizedSourcePath = normalizePath(vueArtifact.source.path);
  const sourceId = sourceIdForPath(normalizedSourcePath);
  const artifacts = [
    artifact("artifact:vuedoc:extraction", "extraction-artifact", vueDocPath, "json", VUEDOC_EXTRACTION_CONTRACT),
    artifact("artifact:htmdoc:bridge", "extraction-artifact", htmDocPath, "json", "hia-htmdoc-extraction"),
    artifact("artifact:cssdoc:bridge", "extraction-artifact", cssDocPath, "json", "hia-cssdoc-extraction"),
    artifact("artifact:hia:document", "extraction-artifact", hiaDocumentPath, "json", "hia-core-document")
  ];
  if (templatePath) {
    artifacts.push(artifact("artifact:vue-template:render", "generated-js", templatePath, "javascript"));
  }
  if (scriptPath) {
    artifacts.push(artifact("artifact:vue-script:compiled", "generated-js", scriptPath, "javascript"));
  }
  if (stylePath) {
    artifacts.push(artifact("artifact:vue-style:compiled", "generated-css", stylePath, "css"));
  }

  const sourceMaps = [
    sourceMap("sourcemap:vue-template", templateMapPath, templatePath, sourceId, "javascript"),
    sourceMap("sourcemap:vue-script", scriptMapPath, scriptPath, sourceId, "javascript"),
    sourceMap("sourcemap:vue-style", styleMapPath, stylePath, sourceId, "css")
  ].filter(Boolean);

  return {
    contract: "doc-source-map",
    contractVersion: "0.1.0-draft",
    id: options.id ?? `docmap:vue-sfc:${slug(normalizedSourcePath)}`,
    producer: {
      name: "@hia-doc/vue-sfc-doc-source-map",
      version: "0.0.0",
      profile: "vue-sfc-bridge"
    },
    artifacts,
    sources: [
      {
        id: sourceId,
        kind: "framework-source",
        path: normalizedSourcePath,
        language: "vue",
        role: "original",
        sourcesContentPolicy: "none"
      }
    ],
    sourceMaps,
    chains: [
      {
        id: "chain:vue-sfc:document",
        stages: [
          {
            from: sourceId,
            to: "artifact:vue-template:render",
            transform: "@vue/compiler-sfc:compileTemplate",
            sourceMap: templateMapPath ? "sourcemap:vue-template" : null,
            linkage: vueArtifact.symbols.map((symbol) => entryIdForSymbol(symbol))
          },
          {
            from: sourceId,
            to: "artifact:vue-style:compiled",
            transform: "@vue/compiler-sfc:compileStyle",
            sourceMap: styleMapPath ? "sourcemap:vue-style" : null,
            linkage: vueArtifact.symbols.filter((symbol) => symbol.kind.startsWith("css-")).map((symbol) => entryIdForSymbol(symbol))
          },
          {
            from: "artifact:vuedoc:extraction",
            to: "artifact:hia:document",
            transform: "vuedoc-to-hia-core",
            sourceMap: null,
            linkage: vueArtifact.symbols.map((symbol) => entryIdForSymbol(symbol))
          }
        ]
      }
    ],
    entries: vueArtifact.symbols.map((symbol) => createSymbolEntry(symbol)),
    privacy: {
      sourcesContentPolicy: "none",
      allowAbsolutePaths: false,
      allowUncPaths: false,
      allowPathTraversal: false,
      releaseGate: {
        requireExplicitEmbedOptIn: true,
        failOnUnsafePath: true,
        failOnUnexpectedSourcesContent: true
      }
    },
    diagnostics: [
      {
        code: "VUE_SFC_BRIDGE_SPIKE",
        severity: "info",
        message: "Vue SFC P1 is modeled as a framework bridge; Vue-specific semantics stay out of HTMDoc/CSSDoc core.",
        data: {
          bridgeBoundary: "framework-adapter"
        }
      }
    ]
  };
}

function createSymbolEntry(symbol) {
  return {
    id: entryIdForSymbol(symbol),
    kind: "symbol",
    symbolKind: symbol.kind,
    symbolId: symbol.id,
    annotation: symbol.annotation
      ? {
          tag: symbol.annotation.tag,
          value: symbol.annotation.value
        }
      : null,
    sourceRefs: [
      {
        sourceId: sourceIdForPath(symbol.source.path),
        range: symbol.annotation?.source?.range ?? symbol.source.range,
        rangeSource: "vue-sfc-parser",
        confidence: symbol.source.confidence ?? "medium"
      }
    ],
    artifactRefs: [artifactRefForSymbol(symbol)],
    diagnostics: []
  };
}

function artifactRefForSymbol(symbol) {
  if (symbol.kind.startsWith("css-")) {
    return {
      artifactId: "artifact:vue-style:compiled",
      selector: symbol.kind === "css-selector" ? symbol.name : null,
      rangeSource: "source-map",
      confidence: "medium"
    };
  }
  if (symbol.kind === "vue-exposed-api") {
    return {
      artifactId: "artifact:vue-script:compiled",
      selector: null,
      rangeSource: "source-map",
      confidence: "medium"
    };
  }
  return {
    artifactId: "artifact:vue-template:render",
    selector: symbol.kind === "vue-component" ? `[data-component="${symbol.name}"]` : null,
    rangeSource: "source-map",
    confidence: "medium"
  };
}

function artifact(id, kind, artifactPath, language, contract) {
  const normalized = normalizePath(artifactPath);
  return {
    id,
    kind,
    path: normalized,
    language,
    role: "generated",
    ...(contract ? { contractRefs: [{ contract, path: normalized }] } : {})
  };
}

function sourceMap(id, mapPath, targetPath, sourceId, language) {
  if (!mapPath) {
    return null;
  }
  return {
    id,
    kind: "ordinary-source-map",
    path: normalizePath(mapPath),
    language,
    mapsFrom: sourceIdForPath(targetPath ?? mapPath),
    mapsTo: sourceId
  };
}

function sourceIdForPath(sourcePath) {
  return `source:vue:${slug(sourcePath)}`;
}

function entryIdForSymbol(symbol) {
  return `entry:${slug(symbol.id)}`;
}

function assertVueDocArtifact(artifactToCheck) {
  if (!artifactToCheck || artifactToCheck.contract !== VUEDOC_EXTRACTION_CONTRACT) {
    throw new Error(`Expected ${VUEDOC_EXTRACTION_CONTRACT} artifact.`);
  }
}

function normalizePath(value) {
  const normalized = String(value).replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("/") || /^[a-zA-Z]:\//.test(normalized) || normalized.split("/").includes("..")) {
    throw new Error(`Unsafe doc-source-map path: ${value}`);
  }
  return normalized;
}

function slug(value) {
  return String(value).trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-|-$/g, "") || "unnamed";
}
