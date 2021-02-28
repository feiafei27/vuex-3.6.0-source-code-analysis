import applyMixin from './mixin'
import devtoolPlugin from './plugins/devtool'
import ModuleCollection from './module/module-collection'
import { forEachValue, isObject, isPromise, assert, partial } from './util'

let Vue // bind on install

export class Store {
  constructor (options = {}) {
    // 如果尚未通过 Vue.use(Vuex) 安装 Vue，并且 window 全局变量有 Vue 属性的话，就为用户自动安装 Vuex。
    // 这种情况适用于通过 script 标签引入 Vue 和 Vuex 的情形。
    if (!Vue && typeof window !== 'undefined' && window.Vue) {
      install(window.Vue)
    }

    // 如果当前是开发环境的话。
    if (__DEV__) {
      // assert 是 util.js 中的函数。
      // 如果第一个参数的 Boolean 为 false 的话，就抛出错误消息为第二个参数的 Error。
      assert(Vue, `must call Vue.use(Vuex) before creating a store instance.`)
      assert(typeof Promise !== 'undefined', `vuex requires a Promise polyfill in this browser.`)
      assert(this instanceof Store, `store must be called with the new operator.`)
    }

    const {
      plugins = [],
      // boolean 值，如果为 true 的话，会使 Vuex store 进入严格模式，在严格模式下，任何 mutation 处理函数以外修改 Vuex state 都会抛出错误。
      strict = false
    } = options

    // 以下划线 _ 开头的变量是对象的内部变量，在这里初始化 store 的内部变量，这并不是 js 的语法，只是编码层次的约定。

    // 提交状态的标志，在_withCommit中，当使用mutation时，会先赋值为true，再执行mutation，修改state后再赋值为false，
    // 在这个过程中，会用watch监听state的变化时是否_committing为true，从而保证只能通过mutation来修改state
    this._committing = false
    // 用于保存所有action，里面会先包装一次
    // 在这里通过 Object.create(null) 创建空的对象，创建的对象的 __proto__ 指向 null，可以创建更加干净的空对象。
    this._actions = Object.create(null)
    // 用于保存订阅action的回调
    this._actionSubscribers = []
    // 用于保存所有的mutation，里面会先包装一次
    this._mutations = Object.create(null)
    // 用于保存包装后的getter
    this._wrappedGetters = Object.create(null)
    // 用于保存一棵 module 树
    this._modules = new ModuleCollection(options)
    // 用于保存namespaced的模块，key 是 namespaced，value是对应的模块对象
    this._modulesNamespaceMap = Object.create(null)
    // 用于监听 mutation，这里对应官网的：https://vuex.vuejs.org/zh/api/#subscribe
    this._subscribers = []
    // 这个 _watcherVM (Vue实例) 用于实现：https://vuex.vuejs.org/zh/api/#watch
    this._watcherVM = new Vue()
    // 用于 get 缓存
    this._makeLocalGettersCache = Object.create(null)

    // 使用 store 指向 this，作用和 const that = this; 是一样的。
    const store = this
    // 获取该类中定义的 dispatch 和 commit 方法。
    const { dispatch, commit } = this
    // 为 dispatch 和 commit 提供一层封装，使这两个函数中的 this 固定指向该类的实例，防止函数中的 this 指向被修改。
    // 如果你也想固定函数中的 this，可以借鉴这种思路：就是为目标函数提供一层封装函数，在封装函数中固定目标函数中 this 的指向，
    // 由于用户只能接触到这个包装函数，所以其无法更改目标函数中的 this 指向。
    this.dispatch = function boundDispatch (type, payload) {
      return dispatch.call(store, type, payload)
    }
    this.commit = function boundCommit (type, payload, options) {
      return commit.call(store, type, payload, options)
    }

    // strict mode
    this.strict = strict
    // 获取根模块的 state
    const state = this._modules.root.state
    // 这个 state 是以模块的 state 为基准，相互嵌套的对象。例如：
    // {
    //   name: 'main module',
    //   foo: {
    //     name: 'foo module'
    //   },
    //   bar: {
    //     name: 'bar module',
    //     tar: {
    //       name: 'tar module'
    //     }
    //   }
    // }

    // 这里是module处理的核心，包括处理根module、action、mutation、getters和递归注册子module
    installModule(this, state, [], this._modules.root)

    // 使用vue实例来保存state和getter
    resetStoreVM(this, state)

    // 安装插件，安装的方法是执行插件函数，参数就是当前的 store 实例。
    plugins.forEach(plugin => plugin(this))

    // options.devtools 的作用是为当前的 Vuex 实例打开或关闭 devtools
    // 如果用户在实例化 Store 类的时候，传递了 devtools 属性的话，就使用 options.devtools，否则的话，以 Vue.config.devtools 为准
    const useDevtools = options.devtools !== undefined ? options.devtools : Vue.config.devtools
    if (useDevtools) {
      // 如果 useDevtools == true，则为当前的 Vuex 实例打开 devtools
      devtoolPlugin(this)
    }
  }

  // this.$store.state.xxx
  get state () {
    return this._vm._data.$$state
  }
  set state (v) {
    if (__DEV__) {
      assert(false, `use store.replaceState() to explicit replace store state.`)
    }
  }

  // 这里的 this 指向 store (Store 的实例)
  commit (_type, _payload, _options) {
    // 统一格式，因为支持对象风格和payload风格
    const {
      type,
      payload,
      options
    } = unifyObjectStyle(_type, _payload, _options)

    const mutation = { type, payload }
    // 获取 type 所对应的 mutation 函数数组
    const entry = this._mutations[type]
    if (!entry) {
      if (__DEV__) {
        // 如果该 type 的 mutation 函数不存在，并且是在开发环境下的话，输出报错信息：不知名的 mutation 类型
        console.error(`[vuex] unknown mutation type: ${type}`)
      }
      // 直接 return，不做其他处理
      return
    }
    // 在 _withCommit 函数中执行回调函数，在回调函数中执行 mutation
    this._withCommit(() => {
      // 遍历并执行 mutation 函数数组中的 mutation
      entry.forEach(function commitIterator (handler) {
        handler(payload)
      })
    })

    // 这里对应官网的：https://vuex.vuejs.org/zh/api/#subscribe
    // 遍历执行 _subscribers 中的函数
    this._subscribers
      .slice() //浅拷贝，以防止订阅者同步调用 unsubscribe 时迭代器失效
      .forEach(sub => sub(mutation, this.state))

    if (
      __DEV__ &&
      options && options.silent
    ) {
      console.warn(
        `[vuex] mutation type: ${type}. Silent option has been removed. ` +
        'Use the filter functionality in the vue-devtools'
      )
    }
  }
  // 这里的 this 指向 store (Store 的实例)
  dispatch (_type, _payload) {
    // 统一格式
    const {
      type,
      payload
    } = unifyObjectStyle(_type, _payload)

    const action = { type, payload }
    // 获取相应 type 的 action 函数数组
    const entry = this._actions[type]
    if (!entry) {
      if (__DEV__) {
        // 提示没有相应 type 的 action
        console.error(`[vuex] unknown action type: ${type}`)
      }
      // 直接 return
      return
    }

    // 这部分对应官网：https://vuex.vuejs.org/zh/api/#subscribeaction
    try {
      this._actionSubscribers
        .slice() // shallow copy to prevent iterator invalidation if subscriber synchronously calls unsubscribe
        // 将没有 before 函数的移除掉
        .filter(sub => sub.before)
        // 遍历并执行每个 before 函数
        .forEach(sub => sub.before(action, this.state))
    } catch (e) {
      if (__DEV__) {
        console.warn(`[vuex] error in before action subscribers: `)
        console.error(e)
      }
    }

    const result = entry.length > 1
      // 如果 action 函数有多个的话，使用 Promise.all 进行处理
      ? Promise.all(entry.map(handler => handler(payload)))
      // 只有一个的话，直接执行就行了，由于在 registerAction 函数中，注册的每个函数的返回值都进行了 promise 的包装，函数的返回值一定是 promise
      : entry[0](payload)

    return new Promise((resolve, reject) => {
      result.then(res => {
        try {
          this._actionSubscribers
            // 将没有 after 函数的移除掉
            .filter(sub => sub.after)
            // 遍历并执行每个 after 函数
            .forEach(sub => sub.after(action, this.state))
        } catch (e) {
          if (__DEV__) {
            console.warn(`[vuex] error in after action subscribers: `)
            console.error(e)
          }
        }
        // resolve 结果值
        resolve(res)
      }, error => {
        try {
          // 由：https://vuex.vuejs.org/zh/api/#subscribeaction 中可知，我们还可以指定 error 处理函数
          this._actionSubscribers
            // 将没有 error 函数的移除掉
            .filter(sub => sub.error)
            // 遍历并执行每个 error 函数
            .forEach(sub => sub.error(action, this.state, error))
        } catch (e) {
          if (__DEV__) {
            console.warn(`[vuex] error in error action subscribers: `)
            console.error(e)
          }
        }
        reject(error)
      })
    })
  }

  // 这里对应官网的：https://vuex.vuejs.org/zh/api/#subscribe
  subscribe (fn, options) {
    return genericSubscribe(fn, this._subscribers, options)
  }
  // 这里对应官网的：https://vuex.vuejs.org/zh/api/#subscribeaction
  subscribeAction (fn, options) {
    // fn 有可能是函数形式以及对象形式，在这里统一转换成对象形式 { before:() => {},after:() => {} }
    const subs = typeof fn === 'function' ? { before: fn } : fn
    return genericSubscribe(subs, this._actionSubscribers, options)
  }

  // 对应官方文档的：https://vuex.vuejs.org/zh/api/#watch
  // 实现方式也很简单，就是利用 Vue 实例的 $watch 方法
  watch (getter, cb, options) {
    if (__DEV__) {
      // Vue 实例的 $watch 的第一个参数也能接受字符串形式的参数，但在这里，要求传递函数类型的参数
      assert(typeof getter === 'function', `store.watch only accepts a function.`)
    }
    // 使用 Vue 实例的 $watch 实现功能，注意这里使用 this.state，this.getters 作为参数执行 getter 函数
    return this._watcherVM.$watch(() => getter(this.state, this.getters), cb, options)
  }
  // 对应官方文档的：https://vuex.vuejs.org/zh/api/#replacestate
  // 替换 store 的根状态，仅用状态合并或时光旅行调试。
  // 实现方式也很简单，就是直接替换 this._vm._data 中的 $$state
  replaceState (state) {
    this._withCommit(() => {
      this._vm._data.$$state = state
    })
  }
  // 对应官方文档的：https://vuex.vuejs.org/zh/api/#registermodule，用于安装新的模块
  registerModule (path, rawModule, options = {}) {
    // 用户可以传递单个的字符串或者字符串数组，在这里进行统一化处理，都变化成字符串数组。
    if (typeof path === 'string') path = [path]

    if (__DEV__) {
      assert(Array.isArray(path), `module path must be a string or an Array.`)
      assert(path.length > 0, 'cannot register the root module by using registerModule.')
    }
    // this._modules 是 Vuex 的模块树，该实例是通过 ModuleCollection 类创建的，请查看该类的 register 方法。
    this._modules.register(path, rawModule)
    // 通过上面的 register，我们得到了最新的模块树，下面进行该模块的安装
    installModule(this, this.state, path, this._modules.get(path), options.preserveState)
    // 通过上面的 installModule，新模块的状态已经更新到当前的 _vm 中了，但是 getter 还没有处理，
    // 下面通过 resetStoreVM，重新生成 _vm 实例，注册 this.state 以及 getters
    resetStoreVM(this, this.state)
  }
  // 对应官方文档的：https://vuex.vuejs.org/zh/api/#unregistermodule，用于卸载某一模块
  unregisterModule (path) {
    // 用户可以传递单个的字符串或者字符串数组，在这里进行统一化处理，都变化成字符串数组。
    if (typeof path === 'string') path = [path]

    if (__DEV__) {
      assert(Array.isArray(path), `module path must be a string or an Array.`)
    }

    // this._modules 是 Vuex 的模块树，该实例是通过 ModuleCollection 类创建的，请查看该类的 unregister 方法，该方法移除模块树中指定的模块。
    this._modules.unregister(path)
    this._withCommit(() => {
      // 移除该模块对应的 _vm 实例中 $$state 的指定 state 对象。
      const parentState = getNestedState(this.state, path.slice(0, -1))
      Vue.delete(parentState, path[path.length - 1])
    })
    // 此时我们有了最新的模块树以及最新的 this.state，接下来执行 resetStore(this) 执行重置操作，
    resetStore(this)
  }
  // 很简单，用于检测是否有某一模块。
  hasModule (path) {
    if (typeof path === 'string') path = [path]

    if (__DEV__) {
      assert(Array.isArray(path), `module path must be a string or an Array.`)
    }

    return this._modules.isRegistered(path)
  }
  hotUpdate (newOptions) {
    this._modules.update(newOptions)
    resetStore(this, true)
  }
  // 在执行mutation的时候，会将_committing设置为true，执行完毕后重置，
  // 在开启strict模式时，会监听state的变化，当变化时_committing不为true时会给出警告
  _withCommit (fn) {
    // 记录 store 现在的 _committing 值
    const committing = this._committing
    // 将 _committing 值设为 true
    this._committing = true
    // 执行传递进来的回调函数。
    fn()
    // 将 _committing 值设置回原来的值
    this._committing = committing
  }
}

// 向 store 的 _subscribers、_actionSubscribers 数组中插入函数，该函数会在每个 mutation 完成后调用。并且返回能够取消该回调函数的函数。
function genericSubscribe (fn, subs, options) {
  // 如果 _subscribers 数组中没有 fn 时，才会向 _subscribers 数组中添加 fn
  if (subs.indexOf(fn) < 0) {

    options && options.prepend
      // 如果用户传递了 { prepend: true } 的话，就将 fn 放置到 _subscribers 的开头
      ? subs.unshift(fn)
      // 否则的话，将 fn 放置到 _subscribers 的结尾
      : subs.push(fn)
  }
  // 返回能够取消该回调函数的函数。
  return () => {
    const i = subs.indexOf(fn)
    if (i > -1) {
      subs.splice(i, 1)
    }
  }
}
// 重新安装 Module，然后重置 _vm。
function resetStore (store, hot) {
  store._actions = Object.create(null)
  store._mutations = Object.create(null)
  store._wrappedGetters = Object.create(null)
  store._modulesNamespaceMap = Object.create(null)
  const state = store.state
  // init all modules
  installModule(store, state, [], store._modules.root, true)
  // reset vm
  resetStoreVM(store, state, hot)
}

// resetStoreVM(this, state)
function resetStoreVM (store, state, hot) {
  // 保存旧的vm，这个 Vue 实例就是用来实现 Store 中数据到页面响应的关键之处。
  const oldVm = store._vm

  // 给 Store 实例设置 getters 对象
  store.getters = {}
  // 给 Store 实例设置 _makeLocalGettersCache 对象
  store._makeLocalGettersCache = Object.create(null)
  // 获取我们在 registerGetter 函数中设置的 _wrappedGetters，就像下面这个样子。
  // _wrappedGetters:
  //   evenOrOdd: ƒ wrappedGetter(store)
  //   fooGet: ƒ wrappedGetter(store)
  //   joo/jooGet: ƒ wrappedGetter(store)
  //   joo/op/c1Get: ƒ wrappedGetter(store)
  const wrappedGetters = store._wrappedGetters
  const computed = {}
  // 对 wrappedGetters 进行遍历
  forEachValue(wrappedGetters, (fn, key) => {
    // export function partial (fn, arg) {
    //   return function () {
    //     return fn(arg)
    //   }
    // }
    // 将 getter 函数添加到 computed 对象中
    computed[key] = partial(fn, store)
    // 这一段很有意思，我们给 store.getters 设置属性，key 是 getter 的路径加上 getter 名称，例如：joo/op/c1Get。
    // 然后，设置的 get 从 _vm 中取值。这使得我们可以通过 this.$store.getters.xxx 取得 getter 值，并且是响应式的。
    Object.defineProperty(store.getters, key, {
      get: () => store._vm[key],
      enumerable: true // for local getters
    })
  })

  // 对应的文档：https://cn.vuejs.org/v2/api/#silent
  const silent = Vue.config.silent
  Vue.config.silent = true
  store._vm = new Vue({
    data: {
      // 将 state 放到这里，使其具有响应式特征。在上面的 Store 类中有 state 的 get，具体如下所示：
      // get state () {
      //   return this._vm._data.$$state
      // }
      // 我们可以看到 Store 的 state 的 get 是从 _vm._data.$$state 中取值。
      // 这使得我们可以通过 this.$store.state.xxx 拿到我们在 Store 中定义的 state 值，并且是响应式的。
      $$state: state
    },
    // computed 用于构造 _vm，这使得从 computed 中拿到的值变成响应式的了。用于实现 this.$store.getters.xxx
    computed
  })
  Vue.config.silent = silent

  // 对应官方文档：https://vuex.vuejs.org/zh/api/#strict
  // 使 Vuex store 进入严格模式，在严格模式下，任何 mutation 处理函数以外修改 Vuex state 都会抛出错误。
  if (store.strict) {
    // 执行这个方法，进入严格模式
    enableStrictMode(store)
  }

  if (oldVm) {
    if (hot) {
      // dispatch changes in all subscribed watchers
      // to force getter re-evaluation for hot reloading.
      store._withCommit(() => {
        oldVm._data.$$state = null
      })
    }
    Vue.nextTick(() => oldVm.$destroy())
  }
}

// 安装模块
// 第一次调用：installModule(this, state, [], this._modules.root)
function installModule (store, rootState, path, module, hot) {
  // 判断是不是根模块
  const isRoot = !path.length
  // 获取指定模块的命名空间
  // 例如有如下 store
  // export default new Vuex.Store({
  //   state,
  //   getters,
  //   actions,
  //   mutations,
  //   modules: {
  //     foo: {
  //       modules: {
  //         joo: {
  //           namespaced: true,
  //           modules: {
  //             op :{
  //               namespaced: true,
  //               modules: {
  //                 c1: {}
  //               }
  //             }
  //           }
  //         },
  //         mm: {
  //           modules: {
  //             jest: {
  //               namespaced: true
  //             },
  //             jk: {}
  //           }
  //         }
  //       }
  //     },
  //     bar: {}
  //   }
  // })
  // 那么模块对应的命名空间如下所示：冒号左边是模块的路径，右面是该模块对应的命名空间。
  // 空数组表示根模块，空字符表示全局命名空间。
  // []:''
  // [foo]:''
  // [foo,joo]:'joo/'
  // [foo,joo,op]:'joo/op/'
  // [foo,joo,op,c1]:'joo/op/'
  // [foo,mm]:''
  // [foo,mm,jest]:'jest/'
  // [foo,mm,jk]:''
  // [bar]:''
  const namespace = store._modules.getNamespace(path)
  // console.log('[' + path + ']' + ":" + namespace)

  // 如果该模块的 namespaced 为 true 的话，说明该模块开启了一个命名空间
  if (module.namespaced) {
    // 如果不同的模块开启了相同的命名空间，并处于开发模式下，则报错。例如：
    // export default new Vuex.Store({
    //   modules: {
    //     foo: {
    //       modules: {
    //         joo: {
    //           namespaced: true,
    //         },
    //         mm: {
    //           modules: {
    //             joo:{
    //               namespaced: true
    //             }
    //           }
    //         }
    //       }
    //     }
    //   }
    // })
    // 则会报错：[vuex] duplicate namespace joo/ for the namespaced module foo/mm/joo
    // 后面的模块 foo/mm/joo 会在 _modulesNamespaceMap 中覆盖 foo/joo
    if (store._modulesNamespaceMap[namespace] && __DEV__) {
      console.error(`[vuex] duplicate namespace ${namespace} for the namespaced module ${path.join('/')}`)
    }
    // 将命名空间以及模块设置进 _modulesNamespaceMap 中
    store._modulesNamespaceMap[namespace] = module
  }

  // 这段代码的作用是将 this._modules.root.state （{ name: "main module" }）这个对象变成多级模块的 state 的集合体，就像下面这个样子：
  // {
  //   name: "main module",
  //   foo: {
  //     name: "foo module"
  //   },
  //   bar: {
  //     name: "bar module",
  //     tar: {
  //       name: "tar module"
  //     }
  //   }
  // }
  // 如果不是根模块且 hot 为 false 的话。
  if (!isRoot && !hot) {
    // 获取当前模块的父模块所对应的 state 对象。
    const parentState = getNestedState(rootState, path.slice(0, -1))
    // 获取当前模块的名称
    const moduleName = path[path.length - 1]
    store._withCommit(() => {
      if (__DEV__) {
        if (moduleName in parentState) {
          console.warn(
            `[vuex] state field "${moduleName}" was overridden by a module with the same name at "${path.join('.')}"`
          )
        }
      }
      // 将该模块的 state 对象，设置到 parentState 中，并且 key 为当前的模块名称
      Vue.set(parentState, moduleName, module.state)
    })
  }

  // 设置当前模块的上下文。
  const local = module.context = makeLocalContext(store, namespace, path)

  // 逐一注册 mutation。
  module.forEachMutation((mutation, key) => {
    const namespacedType = namespace + key
    registerMutation(store, namespacedType, mutation, local)
  })

  // 逐一注册action。
  module.forEachAction((action, key) => {
    // action 有可能是对象形式，看这里：https://vuex.vuejs.org/zh/guide/modules.html 中的 在带命名空间的模块注册全局 action 部分。
    // 如果 root 为 true 的话，type 直接用 key，也就是全局作用域下的 action。否则加上 namespace
    const type = action.root ? key : namespace + key
    // 在 action 是对象的情况下，处理函数是对象的 handler 属性，所以用下面进行兼容
    const handler = action.handler || action
    registerAction(store, type, handler, local)
  })

  // 逐一注册getter
  module.forEachGetter((getter, key) => {
    const namespacedType = namespace + key
    registerGetter(store, namespacedType, getter, local)
  })

  // 逐一注册子module
  module.forEachChild((child, key) => {
    installModule(store, rootState, path.concat(key), child, hot)
  })
}

// 生成某一模块的上下文
function makeLocalContext (store, namespace, path) {
  // 判断当前的命名空间是不是全局命名空间
  const noNamespace = namespace === ''
  console.log(noNamespace + ":::" + namespace)

  // 最终返回的对象
  const local = {
    dispatch: noNamespace ?
    // 如果是全局命名空间的话，直接使用 store 中的 dispatch 函数
    store.dispatch :
    (_type, _payload, _options) => {
      // 由于 dispatch 支持载荷形式和对象形式，所以这里需要统一化的处理，都转换成载荷形式。
      // // 以载荷形式分发
      // store.dispatch('incrementAsync', {
      //   amount: 10
      // }, {
      //   root: true
      // })
      //
      // // 以对象形式分发
      // store.dispatch({
      //   type: 'incrementAsync',
      //   amount: 10
      // }, {
      //   root: true
      // })
      const args = unifyObjectStyle(_type, _payload, _options)
      // 获取载荷形式的 type、payload 和 options
      const { payload, options } = args
      let { type } = args
      // 如果 options 没有传递或者 options.root 为 false 的话，
      // 说明这个 action 需要 dispatch 某一具体的命名空间（而不是全局命名空间）
      if (!options || !options.root) {
        // 往 type 前面拼接上命名空间
        type = namespace + type
        if (__DEV__ && !store._actions[type]) {
          // 如果没有这个 action 的话，输出报错信息
          console.error(`[vuex] unknown local action type: ${args.type}, global type: ${type}`)
          return
        }
      }
      // 使用 store 中的 dispatch 函数进行最后的处理。
      return store.dispatch(type, payload)
    },

    // 和 dispatch 思路一样。
    commit: noNamespace ?
    store.commit :
    (_type, _payload, _options) => {
      const args = unifyObjectStyle(_type, _payload, _options)
      const { payload, options } = args
      let { type } = args

      if (!options || !options.root) {
        type = namespace + type
        if (__DEV__ && !store._mutations[type]) {
          console.error(`[vuex] unknown local mutation type: ${args.type}, global type: ${type}`)
          return
        }
      }
      store.commit(type, payload, options)
    }
  }

  // getters and state object must be gotten lazily
  // because they will be changed by vm update
  Object.defineProperties(local, {
    getters: {
      get: noNamespace
        // 在全局作用域中，
        ? () => store.getters
        : () => makeLocalGetters(store, namespace)
    },
    state: {
      // store.state 是响应式的，因为他是从 this._vm.data.$$state 中取值的
      get: () => getNestedState(store.state, path)
    }
  })

  return local
}

// 该函数的作用是制作某一命名空间所对应的 getters
// 例如：在全局命名空间下，store.getters 有如下的 getter：
// {
//   'evenOrOdd': store._vm['evenOrOdd'],
//   'fooGet': store._vm['fooGet'],
//   'foo/fooGet': store._vm['foo/fooGet'],
//   'foo/op/nameGet': store._vm['foo/op/nameGet']
// }
//              ||
//              ||
// 那么 foo 命名空间的 getters 如下所示：
//              ||
//              ||
//              \/
// {
//   'fooGet': store._vm['foo/fooGet'],
//   'op/nameGet': store._vm['foo/op/nameGet']
// }
function makeLocalGetters (store, namespace) {
  console.log("makeLocalGetters")
  // 先看命名空间 getters 缓存有没有缓存指定命名空间的 getters。
  // 如果有的话，直接返回。没有的话，就创建并添加到缓存中。
  if (!store._makeLocalGettersCache[namespace]) {
    // 创建的目标对象
    const gettersProxy = {}
    // 获取命名空间的长度，例如：'foo/','foo/op/' 的长度
    const splitPos = namespace.length
    Object.keys(store.getters).forEach(type => {
      // 这个 type 是命名空间加上具体的 getter，例如：'foo/fooGet','foo/op/nameGet'
      // 如果这个 type 的命名空间不在 namespace 下面的话，直接 return。
      if (type.slice(0, splitPos) !== namespace) return

      // 获取 type 去掉 namespace 后，剩余的部分，例如上面的 'foo/op/nameGet' 去掉 'foo/' 后，还剩下 'op/nameGet'
      const localType = type.slice(splitPos)

      // 向 gettersProxy 中设置属性，key 就是 localType，value 不变，还是 store.getters[type]
      Object.defineProperty(gettersProxy, localType, {
        get: () => store.getters[type],
        enumerable: true
      })
    })
    // 将该对象设置进缓存中。
    store._makeLocalGettersCache[namespace] = gettersProxy
  }

  return store._makeLocalGettersCache[namespace]
}

// registerMutation(store, namespacedType, mutation, local)
function registerMutation (store, type, handler, local) {
  // 首先判断store._mutations是否存在指定的 type，如果不存在的话给空数组
  const entry = store._mutations[type] || (store._mutations[type] = [])
  // 向 store._mutations[type] 数组中添加包装后的 mutation 函数
  entry.push(function wrappedMutationHandler (payload) {
    // 包一层，commit 函数调用执行 wrappedMutationHandler 时只需要传入payload
    // 执行时让this指向store，参数为当前module上下文的state和用户额外添加的payload
    handler.call(store, local.state, payload)
  })
}

// registerAction(store, type, handler, local)
function registerAction (store, type, handler, local) {
  // 首先判断 store._actions 是否存在指定的 type，如果不存在的话给空数组
  const entry = store._actions[type] || (store._actions[type] = [])
  // 和 registerMutation 一样，向 store._actions 中 push 包装过的函数
  entry.push(function wrappedActionHandler (payload) {
    // 这里对应 Vuex 官网的：https://vuex.vuejs.org/zh/guide/modules.html 中的 "在带命名空间的模块内访问全局内容（Global Assets）"部分
    // action 函数的第一个参数是包含多个属性的对象，具体实现如下所示：
    let res = handler.call(store, {
      dispatch: local.dispatch,
      commit: local.commit,

      getters: local.getters,
      state: local.state,

      rootGetters: store.getters,
      rootState: store.state
    }, payload)
    // 判断 action 函数的返回值是不是 promise，如果不是的话，将其包装成 resolved 状态的 promise，确保其返回值是 promise
    if (!isPromise(res)) {
      res = Promise.resolve(res)
    }

    if (store._devtoolHook) {
      return res.catch(err => {
        store._devtoolHook.emit('vuex:error', err)
        throw err
      })
    } else {
      return res
    }
  })
}

// registerGetter(store, namespacedType, getter, local)
function registerGetter (store, type, rawGetter, local) {
  // 由于 getter 是取值操作，所以不允许有两个相同的 getter
  if (store._wrappedGetters[type]) {
    if (__DEV__) {
      console.error(`[vuex] duplicate getter key: ${type}`)
    }
    return
  }

  // 将 rawGetter 包装一层，并保存到 _wrappedGetters 对象中。
  store._wrappedGetters[type] = function wrappedGetter (store) {
    return rawGetter(
      local.state, // local state
      local.getters, // local getters
      store.state, // root state
      store.getters // root getters
    )
  }
}

// 使 store 进入严格模式
// 实现方法也很简单，就是监听 state 的改变，如果 state 改变的时候，store._committing 的值为 false，则抛出错误。
// 这个 store._committing 只有在 commit mutation，以及 Vuex 库内部对 state 进行更改时才会为 true，其他情况下都是 false。
// 因此，如果用户用除 commit mutation 以外的方法更改 state，则会抛出错误
function enableStrictMode (store) {
  store._vm.$watch(function () { return this._data.$$state }, () => {
    if (__DEV__) {
      assert(store._committing, `do not mutate vuex store state outside mutation handlers.`)
    }
  }, { deep: true, sync: true })
}

// 获取指定路径的模块的 state
function getNestedState (state, path) {
  return path.reduce((state, key) => state[key], state)
}

// 将对象形式统一转换成载荷形式
function unifyObjectStyle (type, payload, options) {
  // 如果是对象形式，将其转换成载荷形式
  if (isObject(type) && type.type) {
    options = payload
    payload = type
    type = type.type
  }

  if (__DEV__) {
    // 对 type 进行断言，type 必须是字符串类型
    assert(typeof type === 'string', `expects string as the type, but found ${typeof type}.`)
  }

  // 返回载荷形式的参数
  return { type, payload, options }
}

// Vuex 插件的 install 方法
export function install (_Vue) {
  // Vue 是当前模块的一个全局变量，该变量会在下面被赋值，这样做可以给当前作用域提供 Vue 对象。
  // 判断 Vue 变量是否已经被赋值，避免二次安装。
  if (Vue && _Vue === Vue) {
    // __DEV__ 出现在 rollup.config.js 中，replace 是 rollup 的一个插件，作用是：在构建代码的时候替换代码中的指定字符串
    // 这里就是做了一个判断，判断是不是开发环境。
    if (__DEV__) {
      // 如果是开发环境的话，发出警告，vuex已经安装，不用再次执行 Vue.use(Vuex) 了。
      console.error(
        '[vuex] already installed. Vue.use(Vuex) should be called only once.'
      )
    }
    return
  }
  // 对 Vue 进行赋值
  Vue = _Vue
  // 执行 Vuex 的安装操作，安装的实现方法是利用Vue的mixin
  applyMixin(Vue)
}
