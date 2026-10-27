# @hia-doc/vue-sfc-bridge

Bridge helpers for VueDoc extraction artifacts.

`vueDocToHiaDocument()` records a `doc-source-map` reference only when
`docSourceMapPath` is provided. It defaults to the current `1.1.0` map
contract; pass `docSourceMapContractVersion` when linking a map created by
another writer or version. The producer adapter passes the version of its
actual generated map.
