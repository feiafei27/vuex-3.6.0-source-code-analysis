export default function (Vue) {
  // 获取当前 Vue 的版本
  const version = Number(Vue.version.split('.')[0])

  // 这里会区分vue的版本，2.x和1.x的生命周期钩子是不一样的，如果是2.x使用beforeCreate，1.x即使用_init。
  if (version >= 2) {
    // Vue.mixin 的官方解释：全局注册一个混入，影响注册之后所有创建的每个 Vue 实例。
    // beforeCreate：生命周期钩子，在实例初始化之后，数据观测 (data observer) 和 event/watcher 事件配置之前被调用。
    // 所以，这一行代码的作用是：之后创建的每个 Vue 实例在 beforeCreate 阶段都会执行 vuexInit 方法。
    Vue.mixin({ beforeCreate: vuexInit })
  } else {
    // 重写 _init 方法，将 vuexInit 方法添加到每个Vue实例的 init 属性中。
    // 注意：_init 是 Vue 的生命周期方法；options.init 是用户在每个Vue实例中自定义的生命周期方法
    const _init = Vue.prototype._init
    Vue.prototype._init = function (options = {}) {
      options.init = options.init
        // 如果用户自定义了 init 方法的话，就将 vuexInit 和 options.init 拼接进一个数组中
        ? [vuexInit].concat(options.init)
        // 否则的话，直接赋值 vuexInit
        : vuexInit
      // 利用 call 执行原始的 _init 函数。此时，每次 Vue 实例初始化的时候都会执行 vuexInit 函数
      _init.call(this, options)
    }
  }

  // Vuex 的初始化函数，作用是将 store 变量赋值给所有 Vue 实例的 $store 属性，这样我们就可以通过 this.$store 访问到 store 了。
  // 在这里，先看下我们在日常使用 Vuex 时的写法：

  // // src/store/index.js
  // import Vue from 'vue'
  // import Vuex from 'vuex'
  //
  // Vue.use(Vuex)
  //
  // const store = new Vuex.Store({
  //   ///////
  // })
  //
  // export default store

  // // src/main.js
  // import Vue from 'vue'
  // import App from './App.vue'
  // import store from './store'
  //
  // Vue.config.productionTip = false
  //
  // new Vue({
  //   store,
  //   render: h => h(App)
  // }).$mount('#app')
  function vuexInit () {
    // 取出当前 Vue 实例的 $options，这个 $options 就是我们写的每个Vue实例的配置对象。
    const options = this.$options
    // 如果配置对象有 store 属性，说明当前的 Vue 实例是根节点，就像上面的 src/main.js 代码那样
    if (options.store) {
      // 给根节点的 $store 属性赋值
      this.$store = typeof options.store === 'function'
        // 如果 store 是函数的话，我们将其返回值赋值给 $store，
        // 这说明我们可以在 src/main.js 代码中，给 store 传递一个函数，不过这个函数的返回值必须是  Vuex.Store 的实例。
        ? options.store()
        // 如果 store 不是函数的话，直接将其赋值给 $store。
        : options.store
    // 如果当前节点有父节点，并且这个父节点有 $store 属性的话，将其赋值给当前节点的 $store 属性。
    // 就这样，一层一层的传递 store 变量，最终的效果就是所有的 Vue 实例都有 $store 这个属性。
    } else if (options.parent && options.parent.$store) {
      this.$store = options.parent.$store
    }
  }
}
