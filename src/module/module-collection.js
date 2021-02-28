import Module from './module'
import { assert, forEachValue } from '../util'

export default class ModuleCollection {
  // rawRootModule：未加工的根模块，就是我们 new Store 时传递的配置对象
  constructor (rawRootModule) {
    // 注册根模块
    this.register([], rawRootModule, false)
  }

  // 根据模块的 path 获取该模块
  get (path) {
    // reduce函数的用法可以看这篇博客：https://www.jianshu.com/p/e375ba1cfc47
    // 注意：如果 path == []，path.reduce() 将会直接返回 this.root
    return path.reduce((module, key) => {
      return module.getChild(key)
    }, this.root)
  }

  // 获取指定模块的命名空间
  getNamespace (path) {
    // 获取根模块
    let module = this.root
    return path.reduce((namespace, key) => {
      module = module.getChild(key)
      return namespace + (module.namespaced ? key + '/' : '')
    }, '')
  }

  update (rawRootModule) {
    update([], this.root, rawRootModule)
  }

  register (path, rawModule, runtime = true) {
    if (__DEV__) {
      // 在开发模式下，对模块的 getters、mutations 以及 actions 的数据类型进行断言，
      // 以确保用户编写的 getters、mutations 以及 actions 符合规范
      assertRawModule(path, rawModule)
    }

    // 实例化当前模块的 Module 对象
    const newModule = new Module(rawModule, runtime)
    // 如果 path 的 length 为 0 的话，说明是第一次执行 register 函数，也就是说当前模块是根模块
    if (path.length === 0) {
      // 将当前模块赋值给 this.root
      this.root = newModule
    } else {
      // 获取该模块的父模块
      const parent = this.get(path.slice(0, -1))
      // 往 parent 模块中添加该子模块
      parent.addChild(path[path.length - 1], newModule)
    }

    // 如果该模块有 modules 属性的话，说明该模块有子模块
    if (rawModule.modules) {
      // 对 rawModule.modules 对象中的各个模块进行遍历，key 是模块的名字，rawChildModule 是模块对象
      forEachValue(rawModule.modules, (rawChildModule, key) => {
        // 对该子模块进行注册，传递的 path 是当前模块的 path 加上该子模块的 key(也就是该子模块的名字)
        // 例如：我们编写的 Store 代码是这样的，那么注册相应模块时的 path 如下所示：
        // new Vuex.Store({            // []
        //   state,
        //   getters,
        //   actions,
        //   mutations,
        //   modules: {
        //     foo: {                  // ['foo']
        //       modules: {
        //         joo: {},            // ['foo', 'joo']
        //         mm: {               // ['foo', 'mm']
        //           modules: {
        //             jest: {}        // ['foo', 'mm', 'jest']
        //           }
        //         }
        //       }
        //     },
        //     bar: {}                 // ['bar']
        //   }
        // })
        this.register(path.concat(key), rawChildModule, runtime)
      })
    }
  }

  unregister (path) {
    const parent = this.get(path.slice(0, -1))
    const key = path[path.length - 1]
    const child = parent.getChild(key)

    if (!child) {
      if (__DEV__) {
        console.warn(
          `[vuex] trying to unregister module '${key}', which is ` +
          `not registered`
        )
      }
      return
    }

    if (!child.runtime) {
      return
    }

    parent.removeChild(key)
  }

  isRegistered (path) {
    const parent = this.get(path.slice(0, -1))
    const key = path[path.length - 1]

    if (parent) {
      return parent.hasChild(key)
    }

    return false
  }
}

function update (path, targetModule, newModule) {
  if (__DEV__) {
    assertRawModule(path, newModule)
  }

  // update target module
  targetModule.update(newModule)

  // update nested modules
  if (newModule.modules) {
    for (const key in newModule.modules) {
      if (!targetModule.getChild(key)) {
        if (__DEV__) {
          console.warn(
            `[vuex] trying to add a new module '${key}' on hot reloading, ` +
            'manual reload is needed'
          )
        }
        return
      }
      update(
        path.concat(key),
        targetModule.getChild(key),
        newModule.modules[key]
      )
    }
  }
}

// 下面是用于断言的代码
const functionAssert = {
  // 如果 value 的类型是 function 的话，返回 true
  assert: value => typeof value === 'function',
  expected: 'function'
}

const objectAssert = {
  // 如果 value 的类型是 function 的话，返回 true
  // 又或者 value 的类型是 object，且其 handler 属性的类型是 function 的话，返回 true
  assert: value => typeof value === 'function' ||
    (typeof value === 'object' && typeof value.handler === 'function'),
  expected: 'function or object with "handler" function'
}

const assertTypes = {
  getters: functionAssert,
  mutations: functionAssert,
  actions: objectAssert
}

function assertRawModule (path, rawModule) {
  // 对模块的 getters、mutations 或者 actions 进行断言，确保这些属性值符合规范
  Object.keys(assertTypes).forEach(key => {
    // 如果该模块的 getters、mutations 或者 actions 属性不存在的话，直接 return，不做检查。
    if (!rawModule[key]) return

    // 获取 getters，mutations 或者 actions 相对应的断言对象。
    const assertOptions = assertTypes[key]
    // 对模块的 getters、mutations 或者 actions 对象中的每一项进行断言
    forEachValue(rawModule[key], (value, type) => {
      // assert 函数的作用之前说过了
      assert(
        // 用断言对象中的 assert 函数对 value 进行断言
        assertOptions.assert(value),
        // 字符串拼接函数，拼接报错 message。
        makeAssertionMessage(path, key, type, value, assertOptions.expected)
      )
    })
  })
}

function makeAssertionMessage (path, key, type, value, expected) {
  let buf = `${key} should be ${expected} but "${key}.${type}"`
  if (path.length > 0) {
    buf += ` in module "${path.join('.')}"`
  }
  buf += ` is ${JSON.stringify(value)}.`
  return buf
}
