export const VUEDOC_EXTRACTION_CONTRACT = "hia-vuedoc-extraction";
export const VUEDOC_EXTRACTION_CONTRACT_VERSION = "0.1.0-draft";
export const VUEDOC_PROFILE_VERSION = "0.1.0-draft";

export const VUEDOC_SYMBOL_KINDS = Object.freeze({
  component: "vue-component",
  slot: "html-slot",
  styleHook: "html-style-hook",
  selector: "css-selector",
  customProperty: "css-custom-property",
  event: "html-event",
  expose: "vue-exposed-api"
});

export const VUEDOC_TAGS = Object.freeze([
  "component",
  "slot",
  "stylehook",
  "selector",
  "cssprop",
  "event",
  "expose",
  "description",
  "lang"
]);

const TAG_TO_KIND = Object.freeze({
  component: VUEDOC_SYMBOL_KINDS.component,
  slot: VUEDOC_SYMBOL_KINDS.slot,
  stylehook: VUEDOC_SYMBOL_KINDS.styleHook,
  selector: VUEDOC_SYMBOL_KINDS.selector,
  cssprop: VUEDOC_SYMBOL_KINDS.customProperty,
  event: VUEDOC_SYMBOL_KINDS.event,
  expose: VUEDOC_SYMBOL_KINDS.expose
});

export function getVueDocSymbolKind(tag) {
  return TAG_TO_KIND[tag] ?? null;
}

export function isVueDocTag(tag) {
  return VUEDOC_TAGS.includes(tag);
}
