import Vuex from '../dist/vuex.common.js'

// .mjs 是什么文件呢？因为 ESM 和 CJS 的加载方式不同，为了更好的区分这两种不同的加载方式，于是创建了 .mjs。
// .mjs 就是表示当前文件用 ESM 的方式进行加载，如果是普通的 .js 文件，则采用 CJS 的方式加载。

const {
  Store,
  install,
  version,
  mapState,
  mapMutations,
  mapGetters,
  mapActions,
  createNamespacedHelpers,
  createLogger
} = Vuex

export {
  Vuex as default,
  Store,
  install,
  version,
  mapState,
  mapMutations,
  mapGetters,
  mapActions,
  createNamespacedHelpers,
  createLogger
}
