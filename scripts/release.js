const fs = require('fs')
const path = require('path')
// chalk的作用是：美化终端输出的文本
const chalk = require('chalk')
// 与语义化版本控制有关的库
// 具体介绍看这里：https://www.npmjs.com/package/semver
const semver = require('semver')
// 这是一个很有意思的库，它可以让你在命令行界面交互式的选择选项
// 具体介绍看这里：https://www.npmjs.com/package/enquirer
const { prompt } = require('enquirer')
// execa的作用是：在js代码中执行shell命令
const execa = require('execa')
// 导入 package.json 中的 version
const currentVersion = require('../package.json').version

// 在这里定义 npm 语义化版本控制选择的选项。
// 关于语义化版本控制的介绍看这里：https://blog.csdn.net/cuk0051/article/details/108342624
const versionIncrements = [
  'patch',
  'minor',
  'major'
]
// 定义选择的 tag
const tags = [
  'latest',
  'next'
]

// 定义增加版本号的函数。
// semver.inc() 函数有两个参数
// 第一个参数是当前的版本号
// 第二个参数是增加版本号的类型，参数的类型有三种，分别是：'patch', 'minor', 'major'
// 例如：此时的版本号是 3.6.0。
// 如果传的第二个参数是 'patch' 的话，返回值就是 '3.6.1'。
// 如果传的第二个参数是 'minor' 的话，返回值就是 '3.7.0'。
// 如果传的第二个参数是 'major' 的话，返回值就是 '4.0.0'。
const inc = (i) => semver.inc(currentVersion, i)
// 获取安装在 node_modules 中指定名称的命令
const bin = (name) => path.resolve(__dirname, `../node_modules/.bin/${name}`)
// 封装一个能够执行命令的函数
const run = (bin, args, opts = {}) => execa(bin, args, { stdio: 'inherit', ...opts })
// 封装一个可以打印出 cyan 颜色字体的函数
const step = (msg) => console.log(chalk.cyan(msg))

// 主函数
async function main() {
  // 这次发布的版本号
  let targetVersion

  // select 类型的 prompt
  // versionIncrements.map(i => `${i} (${inc(i)})`).concat(['custom']) 的返回值是：
  // ['patch (3.6.1)', 'minor (3.7.0)', 'major (4.0.0)', 'custom']
  const { release } = await prompt({
    type: 'select',
    name: 'release',
    message: 'Select release type',
    choices: versionIncrements.map(i => `${i} (${inc(i)})`).concat(['custom'])
  })

  // 如果选择的是自定义类型的话，就使用 input 类型的 prompt，让用户输入自定义的版本号。
  if (release === 'custom') {
    targetVersion = (await prompt({
      type: 'input',
      name: 'version',
      message: 'Input custom version',
      // initial 是显示的初始值
      initial: currentVersion
    })).version
  } else {
    // 否则的话，就利用正则表达式提取出括号中的版本号
    // 例如选择的是 major (4.0.0)，那么 targetVersion 就是 4.0.0
    targetVersion = release.match(/\((.*)\)/)[1]
  }

  // 判断 targetVersion 是不是正规的版本号，正规的版本号是这种形式的：major.minor.patch
  // 如果不是正规的版本号的话，就抛出错误
  if (!semver.valid(targetVersion)) {
    throw new Error(`Invalid target version: ${targetVersion}`)
  }

  // 利用 select 类型的 prompt 选择 tag，可选的 tag 有两种类型，分别是 'latest' 和 'next'
  const { tag } = await prompt({
    type: 'select',
    name: 'tag',
    message: 'Select tag type',
    choices: tags
  })

  console.log(tag)

  // 向用户确定是否是这个版本号
  const { yes: tagOk } = await prompt({
    type: 'confirm',
    name: 'yes',
    message: `Releasing v${targetVersion} with the "${tag}" tag. Confirm?`
  })

  // 如果选择的是不确定的话，return 结束任务
  if (!tagOk) {
    return
  }

  // 打印 'Running tests...' 字符串到控制台
  step('\nRunning tests...')
  // 执行 package.json 中的 test 脚本命令
  await run('yarn', ['test'])

  // 打印 'Updating the package version...' 字符串到控制台
  step('\nUpdating the package version...')
  // 这个函数的作用是更新 package.json 中的 version 字段，主要是文件读写操作。
  updatePackage(targetVersion)

  // 打印 'Building the package...' 字符串到控制台
  step('\nBuilding the package...')
  // 执行 package.json 中的 build 脚本命令
  await run('yarn', ['build'])

  // 打印 'Generating the changelog...' 字符串到控制台
  step('\nGenerating the changelog...')
  // 执行 package.json 中的 changelog 脚本命令
  await run('yarn', ['changelog'])

  // 询问生成的 CHANGELOG.md 文件行不行
  const { yes: changelogOk } = await prompt({
    type: 'confirm',
    name: 'yes',
    message: `Changelog generated. Does it look good?`
  })

  if (!changelogOk) {
    return
  }

  // 执行 git add 以及 git commit 操作
  step('\nCommitting changes...')
  await run('git', ['add', '-A'])
  await run('git', ['commit', '-m', `release: v${targetVersion}`])

  // 发布到 npm 官方仓库中
  step('\nPublishing the package...')
  await run ('yarn', [
    'publish', '--tag', tag, '--new-version', targetVersion, '--no-commit-hooks',
    '--no-git-tag-version'
  ])

  // 将代码 push 到 GitHub.
  step('\nPushing to GitHub...')
  await run('git', ['tag', `v${targetVersion}`])
  await run('git', ['push', 'origin', `refs/tags/v${targetVersion}`])
  await run('git', ['push'])
}

// 这个函数的作用是更新 package.json 中的 version 字段，主要是文件读写操作。
function updatePackage(version) {
  // 获取 package.json 文件的路径
  const pkgPath = path.resolve(path.resolve(__dirname, '..'), 'package.json')
  // 读取 package.json 文件并将其解析成 json 格式
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
  // 赋值新的 =版本号
  pkg.version = version
  // 将 pkg 写回 package.json 文件中
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
}

// 执行 main() 方法
main().catch((err) => console.error(err))
