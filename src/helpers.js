import { isObject } from './util'

// 从 Vuex 的官方介绍可知：https://vuex.vuejs.org/zh/api/#mapstate
// mapState、mapGetters、mapMutations 和 mapActions 四个辅助函数有两种调用方法：
// (1): 只传递了 map，例如：mapState({ count: state => state.count })
// (2): 传递了 namespace(命名空间) 和 map，例如：mapState( 'some/nested/module', { a: state => state.a, } )
function normalizeNamespace (fn) {
  // 这个返回的函数就是我们使用的：mapState、mapGetters、mapMutations 和 mapActions
  // 这种写法能够提取 mapState、mapGetters、mapMutations 和 mapActions 中公共的部分
  // 值得我们借鉴和学习
  return (namespace, map) => {
    // 如果 namespace 不是字符串的话，说明用户只传递了 map 作为第一个参数
    if (typeof namespace !== 'string') {
      // 将 namespace 值赋值给 map
      map = namespace
      // namespace 设为空字符串，因为用户没有传递 namespace，所以默认为全局命名空间
      namespace = ''
    // 第二种情况是传递了 namespace 和 map 的情况
    } else if (namespace.charAt(namespace.length - 1) !== '/') {
      // 此时已经确认了是第二种情况，在这里对 namespace 进行一定的标准化，就是要求以 '/' 结尾
      namespace += '/'
    }
    // 调用 mapState、mapGetters、mapMutations 和 mapActions 相应的个性化代码，上面是公共的代码部分。
    return fn(namespace, map)
  }
}

/**
 * Reduce the code which written in Vue.js for getting the state.
 * @param {String} [namespace] - Module's namespace
 * @param {Object|Array} states # Object's item can be a function which accept state and getters for param, you can do something for state and getters in it.
 * @param {Object}
 */
export const mapState = normalizeNamespace((namespace, states) => {
  // 最终返回的对象
  const res = {}
  if (__DEV__ && !isValidMap(states)) {
    console.error('[vuex] mapState: mapper parameter must be either an Array or an Object')
  }
  // 标准化 states，具体效果看下面的例子：
  // normalizeMap([1, 2, 3]) => [ { key: 1, val: 1 }, { key: 2, val: 2 }, { key: 3, val: 3 } ]
  // normalizeMap({a: 1, b: 2}) => [ { key: 'a', val: 1 }, { key: 'b', val: 2 } ]
  normalizeMap(states).forEach(({ key, val }) => {
    res[key] = function mappedState () {
      // 获取全局命名空间下的 state 和 getters
      let state = this.$store.state
      let getters = this.$store.getters
      // 如果用户传递了 namespace 的话，
      if (namespace) {
        const module = getModuleByNamespace(this.$store, 'mapState', namespace)
        if (!module) {
          return
        }
        // 获取该命名空间下的 state 和 getters
        state = module.context.state
        getters = module.context.getters
      }
      // 有两种写法：(1) count: state => state.count  (2) countAlias: 'count'
      return typeof val === 'function'
        ? val.call(this, state, getters)
        : state[val]
    }
    // mark vuex getter for devtools
    res[key].vuex = true
  })
  return res
})

/**
 * Reduce the code which written in Vue.js for getting the getters
 * @param {String} [namespace] - Module's namespace
 * @param {Object|Array} getters
 * @return {Object}
 */
// mapGetters 比较简单，把 val 映射到 this.$store.getters 中就可以了
export const mapGetters = normalizeNamespace((namespace, getters) => {
  // 最终返回的对象
  const res = {}
  if (__DEV__ && !isValidMap(getters)) {
    console.error('[vuex] mapGetters: mapper parameter must be either an Array or an Object')
  }
  // 标准化 states，具体效果看下面的例子：
  // normalizeMap([1, 2, 3]) => [ { key: 1, val: 1 }, { key: 2, val: 2 }, { key: 3, val: 3 } ]
  // normalizeMap({a: 1, b: 2}) => [ { key: 'a', val: 1 }, { key: 'b', val: 2 } ]
  normalizeMap(getters).forEach(({ key, val }) => {
    // getter 的全称，命名空间加上具体的 getter 名
    val = namespace + val
    res[key] = function mappedGetter () {
      if (namespace && !getModuleByNamespace(this.$store, 'mapGetters', namespace)) {
        return
      }
      if (__DEV__ && !(val in this.$store.getters)) {
        console.error(`[vuex] unknown getter: ${val}`)
        return
      }
      return this.$store.getters[val]
    }
    // mark vuex getter for devtools
    res[key].vuex = true
  })
  return res
})

/**
 * Reduce the code which written in Vue.js for committing the mutation
 * @param {String} [namespace] - Module's namespace
 * @param {Object|Array} mutations # Object's item can be a function which accept `commit` function as the first param, it can accept anthor params. You can commit mutation and do any other things in this function. specially, You need to pass anthor params from the mapped function.
 * @return {Object}
 */
export const mapMutations = normalizeNamespace((namespace, mutations) => {
  // 最终返回的对象
  const res = {}
  if (__DEV__ && !isValidMap(mutations)) {
    console.error('[vuex] mapMutations: mapper parameter must be either an Array or an Object')
  }
  normalizeMap(mutations).forEach(({ key, val }) => {
    res[key] = function mappedMutation (...args) {
      // 获取全局命名空间的 commit
      let commit = this.$store.commit
      if (namespace) {
        // 如果有命名空间的话，获取该命名空间的 commit
        const module = getModuleByNamespace(this.$store, 'mapMutations', namespace)
        if (!module) {
          return
        }
        commit = module.context.commit
      }
      return typeof val === 'function'
        // 如果用户自己写的是函数的话，就执行这个函数就行了，将其所需要的参数传递进去。
        ? val.apply(this, [commit].concat(args))
        // 否则的话，就在这里执行 commit
        : commit.apply(this.$store, [val].concat(args))
    }
  })
  return res
})

/**
 * Reduce the code which written in Vue.js for dispatch the action
 * @param {String} [namespace] - Module's namespace
 * @param {Object|Array} actions # Object's item can be a function which accept `dispatch` function as the first param, it can accept anthor params. You can dispatch action and do any other things in this function. specially, You need to pass anthor params from the mapped function.
 * @return {Object}
 */
// 和 mapMutations 一样，只不过把 commit 换成了 dispatch
export const mapActions = normalizeNamespace((namespace, actions) => {
  const res = {}
  if (__DEV__ && !isValidMap(actions)) {
    console.error('[vuex] mapActions: mapper parameter must be either an Array or an Object')
  }
  normalizeMap(actions).forEach(({ key, val }) => {
    res[key] = function mappedAction (...args) {
      // get dispatch function from store
      let dispatch = this.$store.dispatch
      if (namespace) {
        const module = getModuleByNamespace(this.$store, 'mapActions', namespace)
        if (!module) {
          return
        }
        dispatch = module.context.dispatch
      }
      return typeof val === 'function'
        ? val.apply(this, [dispatch].concat(args))
        : dispatch.apply(this.$store, [val].concat(args))
    }
  })
  return res
})

/**
 * Rebinding namespace param for mapXXX function in special scoped, and return them by simple object
 * @param {String} namespace
 * @return {Object}
 */
// 利用 bind 绑定 namespace 参数
export const createNamespacedHelpers = (namespace) => ({
  mapState: mapState.bind(null, namespace),
  mapGetters: mapGetters.bind(null, namespace),
  mapMutations: mapMutations.bind(null, namespace),
  mapActions: mapActions.bind(null, namespace)
})

/////////////////////////////////////// 下面是一些辅助函数 ///////////////////////////////////////

/**
 * 标准化 map 参数，具体看下面的例子：
 * normalizeMap([1, 2, 3]) => [ { key: 1, val: 1 }, { key: 2, val: 2 }, { key: 3, val: 3 } ]
 * normalizeMap({a: 1, b: 2, c: 3}) => [ { key: 'a', val: 1 }, { key: 'b', val: 2 }, { key: 'c', val: 3 } ]
 * @param {Array|Object} map
 * @return {Object}
 */
function normalizeMap (map) {
  if (!isValidMap(map)) {
    return []
  }
  return Array.isArray(map)
    ? map.map(key => ({ key, val: key }))
    : Object.keys(map).map(key => ({ key, val: map[key] }))
}

/**
 * 验证 map 参数是不是一个数组或者对象
 * @param {*} map
 * @return {Boolean}
 */
function isValidMap (map) {
  return Array.isArray(map) || isObject(map)
}

/**
 * 在 store 中通过 namespace 获取指定的模块，如果这个模块不存在的话，则打印错误信息
 * Search a special module from store by namespace. if module not exist, print error message.
 * @param {Object} store
 * @param {String} helper
 * @param {String} namespace
 * @return {Object}
 */
function getModuleByNamespace (store, helper, namespace) {
  const module = store._modulesNamespaceMap[namespace]
  if (__DEV__ && !module) {
    console.error(`[vuex] module namespace not found in ${helper}(): ${namespace}`)
  }
  return module
}
