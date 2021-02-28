// fs-extra是系统fs模块的拓展，提供了更多便利的API，并继承了fs模块的API。
const fs = require('fs-extra')
// chalk的作用是：美化终端输出的文本
const chalk = require('chalk')
// execa的作用是：在js代码中执行shell命令
const execa = require('execa')
// gzipSync：node官方库提供的函数，用于压缩文件
const { gzipSync } = require('zlib')
// compress：第三方库brotli提供的函数，用于压缩文件
const { compress } = require('brotli')

// 导出的 run 方法，主线思路在这里。
async function run(config, files) {
  // build(config) 使用 rollup 进行代码的构建；copy() 只是简单地将 src/index.mjs 拷贝到 dist/vuex.mjs
  await Promise.all([build(config), copy()])
  // 检查 rollup 构建出的文件的尺寸，将相关信息打印出来
  checkAllSizes(files)
}

// 执行 rollup 构建代码，配置文件是 config
async function build(config) {
  await execa('rollup', ['-c', config], { stdio: 'inherit' })
}

// 简单地将 src/index.mjs 拷贝到 dist/vuex.mjs
async function copy() {
  await fs.copy('src/index.mjs', 'dist/vuex.mjs')
}

// 检查 rollup 构建出的文件的尺寸，将相关信息打印出来
function checkAllSizes(files) {
  console.log()
  // 对每一个文件进行遍历检查
  files.map((f) => checkSize(f))
  console.log()
}

// 检查每个文件的函数，打印出尺寸相关的信息
function checkSize(file) {
  // 使用 fs 读取文件
  const f = fs.readFileSync(file)
  // 文件原始的尺寸
  const minSize = (f.length / 1024).toFixed(2) + 'kb'
  // 使用 gzipSync 压缩文件
  const gzipped = gzipSync(f)
  // 使用 gzipSync 压缩过后的文件大小
  const gzippedSize = (gzipped.length / 1024).toFixed(2) + 'kb'
  // 使用 compress 压缩文件
  const compressed = compress(f)
  // 使用 compress 压缩过后的文件大小
  const compressedSize = (compressed.length / 1024).toFixed(2) + 'kb'
  // 使用 console.log() 输出相关信息，这里借助 chalk 输出带有样式的文本。
  console.log(
    `${chalk.gray(
      chalk.bold(file)
    )} size:${minSize} / gzip:${gzippedSize} / brotli:${compressedSize}`
  )
}

module.exports = { run }
