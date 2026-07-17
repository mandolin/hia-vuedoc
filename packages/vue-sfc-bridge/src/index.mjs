import { VUEDOC_EXTRACTION_CONTRACT } from "@hia-doc/vuedoc-spec";

const HIA_CORE_SCHEMA_VERSION = "0.2.0";
const HIA_SOURCE_MODEL = "hia-source";
const HIA_SOURCE_MODEL_VERSION = "0.2.0";

export function vueDocToHtmlExtraction(vueArtifact, options = {}) {
  assertVueDocArtifact(vueArtifact);
  const templatePath = normalizePath(options.templatePath ?? vueArtifact.source.path);
  const symbols = vueArtifact.symbols
    .filter((symbol) => symbol.kind === "vue-component" || symbol.kind.startsWith("html-"))
    .map((symbol) => ({
      id: symbol.id,
      kind: symbol.kind === "vue-component" ? "html-component" : symbol.kind,
      name: symbol.name,
      parentId: symbol.parentId,
      summary: symbol.summary,
      source: {
        path: vueArtifact.source.path,
        range: symbol.source.range,
        rangeSource: symbol.source.rangeSource,
        confidence: symbol.source.confidence
      },
      annotation: symbol.annotation,
      metadata: {
        bridge: "vue-sfc-htmdoc",
        vueSymbolKind: symbol.kind,
        templateArtifact: templatePath
      }
    }));

  return {
    contract: "hia-htmdoc-extraction",
    contractVersion: "0.1.0-draft",
    producer: {
      name: "@hia-doc/vue-sfc-bridge",
      version: "0.0.0"
    },
    profile: {
      name: "vue-sfc-htmdoc-bridge",
      version: "0.1.0-draft"
    },
    source: {
      kind: "vue-template",
      path: vueArtifact.source.path
    },
    symbols,
    annotations: vueArtifact.annotations.filter((annotation) => annotation.source.blockType === "template"),
    diagnostics: vueArtifact.diagnostics ?? [],
    sourceMap: {
      kind: "hia-doc-source-map-ref",
      href: options.docSourceMapPath ?? null,
      sourcesContentPolicy: "none"
    },
    metadata: {
      sourceContract: vueArtifact.contract,
      bridgeBoundary: "framework-adapter"
    }
  };
}

export function vueDocToCssExtraction(vueArtifact, options = {}) {
  assertVueDocArtifact(vueArtifact);
  const stylePath = normalizePath(options.stylePath ?? vueArtifact.source.path);
  const symbols = vueArtifact.symbols
    .filter((symbol) => symbol.kind.startsWith("css-"))
    .map((symbol) => ({
      id: symbol.id,
      kind: symbol.kind,
      name: symbol.name,
      parentId: symbol.parentId,
      summary: symbol.summary,
      source: {
        path: vueArtifact.source.path,
        range: symbol.source.range,
        rangeSource: symbol.source.rangeSource,
        confidence: symbol.source.confidence
      },
      annotation: symbol.annotation,
      metadata: {
        bridge: "vue-sfc-cssdoc",
        styleArtifact: stylePath
      }
    }));

  return {
    contract: "hia-cssdoc-extraction",
    contractVersion: "0.1.0-draft",
    producer: {
      name: "@hia-doc/vue-sfc-bridge",
      version: "0.0.0"
    },
    profile: {
      name: "vue-sfc-cssdoc-bridge",
      version: "0.1.0-draft"
    },
    source: {
      kind: "vue-style",
      path: vueArtifact.source.path
    },
    symbols,
    annotations: vueArtifact.annotations.filter((annotation) => annotation.source.blockType === "style"),
    diagnostics: vueArtifact.diagnostics ?? [],
    sourceMap: {
      kind: "hia-doc-source-map-ref",
      href: options.docSourceMapPath ?? null,
      sourcesContentPolicy: "none"
    },
    metadata: {
      sourceContract: vueArtifact.contract,
      bridgeBoundary: "framework-adapter"
    }
  };
}

export function vueDocToHiaDocument(vueArtifact, options = {}) {
  assertVueDocArtifact(vueArtifact);
  const title = options.title ?? "Vue SFC Document";
  const symbols = vueArtifact.symbols.map((symbol) => mapVueSymbol(symbol));

  return {
    schemaVersion: HIA_CORE_SCHEMA_VERSION,
    id: options.id ?? `vuedoc:${vueArtifact.source.path}`,
    title,
    defaultLocale: options.defaultLocale ?? "en",
    locales: options.locales ?? ["en"],
    nodes: [
      {
        id: "root",
        kind: "root",
        title,
        symbolIds: symbols.map((symbol) => symbol.id)
      }
    ],
    symbols,
    diagnostics: vueArtifact.diagnostics ?? [],
    metadata: {
      sourceContract: vueArtifact.contract,
      sourceContractVersion: vueArtifact.contractVersion,
      producer: vueArtifact.producer,
      bridgeBoundary: "framework-adapter",
      docSourceMaps: options.docSourceMapPath
        ? [
            {
              contract: "doc-source-map",
              contractVersion: "0.1.0-draft",
              path: options.docSourceMapPath,
              entryArtifact: options.entryArtifact ?? null
            }
          ]
        : []
    }
  };
}

export function assertVueDocArtifact(artifact) {
  if (!artifact || artifact.contract !== VUEDOC_EXTRACTION_CONTRACT) {
    throw new Error(`Expected ${VUEDOC_EXTRACTION_CONTRACT} artifact.`);
  }
  if (!Array.isArray(artifact.symbols)) {
    throw new Error("VueDoc extraction artifact must contain symbols array.");
  }
}

function mapVueSymbol(symbol) {
  return {
    id: symbol.id,
    name: symbol.name,
    kind: coreKindForSymbol(symbol),
    parentId: symbol.parentId,
    summary: symbol.summary,
    source: {
      model: HIA_SOURCE_MODEL,
      modelVersion: HIA_SOURCE_MODEL_VERSION,
      mode: "link",
      definedIn: {
        kind: "defined-in",
        relativePath: symbol.source?.path ?? "Component.vue",
        language: "vue",
        position: symbol.source?.range?.start ?? { line: 1, column: 1 },
        range: symbol.source?.range,
        link: {
          enabled: false,
          openMode: "same-tab"
        }
      },
      primaryBlock: null,
      references: [],
      fragments: [],
      diagnostics: []
    },
    diagnostics: symbol.diagnostics ?? [],
    metadata: {
      vuedoc: {
        vueSymbolKind: symbol.kind,
        annotation: symbol.annotation ?? null,
        bridgeTargets: symbol.metadata?.bridgeTargets ?? [],
        macro: symbol.metadata?.macro ?? null,
        localName: symbol.metadata?.localName ?? null
      }
    }
  };
}

function coreKindForSymbol(symbol) {
  if (symbol.kind === "vue-component") {
    return "html-component";
  }
  return symbol.kind;
}

function normalizePath(value) {
  const normalized = String(value).replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("/") || /^[a-zA-Z]:\//.test(normalized) || normalized.split("/").includes("..")) {
    throw new Error(`Unsafe Vue bridge path: ${value}`);
  }
  return normalized;
}
