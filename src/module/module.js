import { forEachValue } from '../util'

// Vuex 中的模块类，描述了模块的属性和方法
export default class Module {
  constructor (rawModule, runtime) {
    this.runtime = runtime
    // 用于存储该模块子模块的对象
    this._children = Object.create(null)
    // 存储程序员传递的未经处理的模块对象
    this._rawModule = rawModule
    // 获取该模块未经处理的 state
    const rawState = rawModule.state

    // 存储该模块未经处理的 state
    // 由 Vuex 的官网可知：模块的 state 可以是一个函数，该函数的返回值是 state 对象，具体的代码体现就是下面这一行代码，
    // 如果用户传递的 state 是函数的话，就使用该函数的返回值，如果传递的是一个对象的话，就直接使用该对象。
    // 如果用户未传递 state 的话，state 的值就是 undefined，此时就使用 || 后面的 {}，这起到默认值的作用
    this.state = (typeof rawState === 'function' ? rawState() : rawState) || {}
  }

  // namespaced 的 getter
  get namespaced () {
    return !!this._rawModule.namespaced
  }

  // 添加子模块
  addChild (key, module) {
    this._children[key] = module
  }

  // 移除子模块
  removeChild (key) {
    delete this._children[key]
  }

  // 获取子模块
  getChild (key) {
    return this._children[key]
  }

  // 是否有某一子模块
  hasChild (key) {
    return key in this._children
  }

  update (rawModule) {
    this._rawModule.namespaced = rawModule.namespaced
    if (rawModule.actions) {
      this._rawModule.actions = rawModule.actions
    }
    if (rawModule.mutations) {
      this._rawModule.mutations = rawModule.mutations
    }
    if (rawModule.getters) {
      this._rawModule.getters = rawModule.getters
    }
  }

  forEachChild (fn) {
    forEachValue(this._children, fn)
  }

  forEachGetter (fn) {
    if (this._rawModule.getters) {
      forEachValue(this._rawModule.getters, fn)
    }
  }

  forEachAction (fn) {
    if (this._rawModule.actions) {
      forEachValue(this._rawModule.actions, fn)
    }
  }

  forEachMutation (fn) {
    if (this._rawModule.mutations) {
      forEachValue(this._rawModule.mutations, fn)
    }
  }
}
