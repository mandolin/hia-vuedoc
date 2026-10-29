# @hia-doc/vue-sfc-bridge

Bridge helpers for VueDoc extraction artifacts.

`vueDocToCssExtraction()` emits `hia-cssdoc-extraction@1.0.0` paired with
artifact profile version `1.0.0`. It preserves the existing Vue style subset,
omits absent optional fields, and keeps nested i18n/annotation ownership shared.
It does not broaden CSS syntax or change the Vue/HTML extraction identities.
Use a CSSDoc reader supporting exact current/legacy contracts when consuming
the output; old persisted `0.1.0-draft` artifacts require its explicit migration.

中文：CSS桥接身份与配对profile协调至1.0.0，既有Vue/HTM工件及来源精度不变。

`vueDocToHiaDocument()` records a `doc-source-map` reference only when
`docSourceMapPath` is provided. It defaults to the current `1.1.0` map
contract; pass `docSourceMapContractVersion` when linking a map created by
another writer or version. The producer adapter passes the version of its
actual generated map.
