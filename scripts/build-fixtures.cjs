const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..");
const fixtureRoot = path.join(root, "fixtures", "doc-source-map", "vue-sfc");
const distRoot = path.join(fixtureRoot, "dist");
const sourcePath = "fixtures/doc-source-map/vue-sfc/src/components/ProfileCard.vue";

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  const [
    extractor,
    bridge,
    docSourceMap
  ] = await Promise.all([
    import(pathToFileURL(path.join(root, "packages", "vue-sfc-extractor", "src", "index.mjs"))),
    import(pathToFileURL(path.join(root, "packages", "vue-sfc-bridge", "src", "index.mjs"))),
    import(pathToFileURL(path.join(root, "packages", "vue-sfc-doc-source-map", "src", "index.mjs")))
  ]);

  fs.rmSync(distRoot, { recursive: true, force: true });
  fs.mkdirSync(distRoot, { recursive: true });

  const sourceText = fs.readFileSync(path.join(root, sourcePath), "utf8");
  const vueArtifact = extractor.extractVueSfc(sourceText, { path: sourcePath });
  const compiled = extractor.compileVueSfc(sourceText, {
    path: sourcePath,
    id: "profile-card"
  });

  const outputRefs = writeCompiledOutputs(compiled.outputs);
  const htmDoc = bridge.vueDocToHtmlExtraction(vueArtifact, {
    docSourceMapPath: "ProfileCard.docmap.json",
    templatePath: outputRefs.templatePath ?? sourcePath
  });
  const cssDoc = bridge.vueDocToCssExtraction(vueArtifact, {
    docSourceMapPath: "ProfileCard.docmap.json",
    stylePath: outputRefs.stylePath ?? sourcePath
  });
  const hiaDocument = bridge.vueDocToHiaDocument(vueArtifact, {
    id: "vuedoc:ProfileCard",
    title: "ProfileCard.vue",
    docSourceMapPath: "ProfileCard.docmap.json",
    entryArtifact: outputRefs.templatePath ?? null
  });
  const docMap = docSourceMap.createVueSfcDocSourceMap({
    vueArtifact,
    vueDocPath: "ProfileCard.vuedoc.json",
    htmDocPath: "ProfileCard.htmdoc.json",
    cssDocPath: "ProfileCard.cssdoc.json",
    hiaDocumentPath: "ProfileCard.hia.json",
    ...outputRefs
  });

  writeJson("ProfileCard.vuedoc.json", vueArtifact);
  writeJson("ProfileCard.htmdoc.json", htmDoc);
  writeJson("ProfileCard.cssdoc.json", cssDoc);
  writeJson("ProfileCard.hia.json", hiaDocument);
  writeJson("ProfileCard.docmap.json", docMap);

  console.log("VueDoc Vue SFC bridge fixture artifacts generated.");
}

function writeCompiledOutputs(outputs) {
  const refs = {};
  for (const output of outputs) {
    if (output.kind === "template-render") {
      refs.templatePath = "ProfileCard.template.js";
      writeText(refs.templatePath, output.content);
      if (output.map) {
        refs.templateMapPath = "ProfileCard.template.js.map";
        writeJson(refs.templateMapPath, output.map);
      }
    }
    if (output.kind === "script") {
      refs.scriptPath = "ProfileCard.script.js";
      writeText(refs.scriptPath, output.content);
      if (output.map) {
        refs.scriptMapPath = "ProfileCard.script.js.map";
        writeJson(refs.scriptMapPath, output.map);
      }
    }
    if (output.kind === "style") {
      refs.stylePath = "ProfileCard.style.css";
      writeText(refs.stylePath, output.content);
      if (output.map) {
        refs.styleMapPath = "ProfileCard.style.css.map";
        writeJson(refs.styleMapPath, output.map);
      }
    }
  }
  return refs;
}

function writeText(name, content) {
  fs.writeFileSync(path.join(distRoot, name), `${content.replace(/\r?\n+$/g, "")}\n`, "utf8");
}

function writeJson(name, value) {
  fs.writeFileSync(path.join(distRoot, name), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
