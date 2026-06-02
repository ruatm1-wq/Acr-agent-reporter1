/**
 * 分析引擎 — Tree-sitter WASM 语法检查 + 指纹去重
 * 支持 90+ 编程语言，零原生编译依赖
 */

const path = require('path')
const fs = require('fs')

let ParserClass = null
let LanguageClass = null
const loadedLangs = new Map()
let ready = false

const LANGUAGES = {
  ada:           { exts: ['.ada', '.adb', '.ads'] },
  angular:       { exts: ['.ng', '.ng.html'] },
  arduino:       { exts: ['.ino', '.pde'] },
  asm:           { exts: ['.asm', '.s', '.S'] },
  astro:         { exts: ['.astro'] },
  awk:           { exts: ['.awk'] },
  bash:          { exts: ['.sh', '.bash', '.zsh'] },
  c:             { exts: ['.c', '.h'] },
  cairo:         { exts: ['.cairo'] },
  clojure:       { exts: ['.clj', '.cljs', '.cljc', '.edn'] },
  cmake:         { exts: ['.cmake', 'CMakeLists.txt'] },
  commonlisp:    { exts: ['.lisp', '.lsp', '.cl'] },
  cpp:           { exts: ['.cpp', '.hpp', '.cxx', '.cc', '.hh', '.c++', '.h++'] },
  css:           { exts: ['.css', '.scss', '.less'] },
  cuda:          { exts: ['.cu', '.cuh'] },
  c_sharp:       { exts: ['.cs'] },
  d:             { exts: ['.d'] },
  dart:          { exts: ['.dart'] },
  desktop:       { exts: ['.desktop'] },
  dockerfile:    { exts: ['Dockerfile', '.dockerfile'] },
  dtd:           { exts: ['.dtd'] },
  elisp:         { exts: ['.el'] },
  elixir:        { exts: ['.ex', '.exs'] },
  elm:           { exts: ['.elm'] },
  embedded_template: { exts: ['.eex', '.heex', '.leex'] },
  erlang:        { exts: ['.erl', '.hrl'] },
  fish:          { exts: ['.fish'] },
  fortran:       { exts: ['.f', '.f90', '.f95', '.f03', '.f08'] },
  gdscript:      { exts: ['.gd'] },
  gdshader:      { exts: ['.gdshader'] },
  gleam:         { exts: ['.gleam'] },
  glsl:          { exts: ['.glsl', '.vert', '.frag', '.geom', '.comp', '.tesc', '.tese'] },
  go:            { exts: ['.go'] },
  graphql:       { exts: ['.graphql', '.gql'] },
  groovy:        { exts: ['.groovy', '.gvy', '.gsh'] },
  haskell:       { exts: ['.hs', '.lhs'] },
  hcl:           { exts: ['.hcl', '.tf', '.tfvars'] },
  html:          { exts: ['.html', '.htm', '.xhtml'] },
  ini:           { exts: ['.ini', '.cfg', '.conf'] },
  java:          { exts: ['.java'] },
  javascript:    { exts: ['.js', '.mjs', '.cjs'] },
  jq:            { exts: ['.jq'] },
  json:          { exts: ['.json'] },
  julia:         { exts: ['.jl'] },
  just:          { exts: ['justfile'] },
  kdl:           { exts: ['.kdl'] },
  kotlin:        { exts: ['.kt', '.kts'] },
  latex:         { exts: ['.tex', '.sty', '.cls', '.ltx'] },
  liquid:        { exts: ['.liquid'] },
  lua:           { exts: ['.lua'] },
  make:          { exts: ['Makefile', '.mk'] },
  markdown:      { exts: ['.md', '.mdx'] },
  matlab:        { exts: ['.m'] },
  nginx:         { exts: ['.nginx', '.nix'] },
  nim:           { exts: ['.nim'] },
  nix:           { exts: ['.nix'] },
  objc:          { exts: ['.m', '.mm'] },
  ocaml:         { exts: ['.ml', '.mli'] },
  perl:          { exts: ['.pl', '.pm', '.t'] },
  php:           { exts: ['.php', '.phtml', '.php3', '.php4', '.php5'] },
  php_only:      { exts: ['.php'] },
  powershell:    { exts: ['.ps1', '.psm1', '.psd1'] },
  prisma:        { exts: ['.prisma'] },
  proto:         { exts: ['.proto'] },
  python:        { exts: ['.py', '.pyw'] },
  qmljs:         { exts: ['.qml'] },
  r:             { exts: ['.r', '.R', '.Rmd'] },
  racket:        { exts: ['.rkt', '.scrbl'] },
  razor:         { exts: ['.cshtml', '.razor'] },
  regex:         { exts: ['.regex'] },
  requirements:  { exts: ['requirements.txt'] },
  ruby:          { exts: ['.rb', '.erb'] },
  rust:          { exts: ['.rs'] },
  scala:         { exts: ['.scala', '.sc'] },
  scheme:        { exts: ['.scm', '.ss'] },
  scss:          { exts: ['.scss', '.sass'] },
  solidity:      { exts: ['.sol'] },
  sql:           { exts: ['.sql'] },
  svelte:        { exts: ['.svelte'] },
  swift:         { exts: ['.swift'] },
  systemverilog: { exts: ['.sv', '.svh'] },
  templ:         { exts: ['.templ'] },
  terraform:     { exts: ['.tf', '.tfvars'] },
  toml:          { exts: ['.toml'] },
  tsx:           { exts: ['.tsx'] },
  typescript:    { exts: ['.ts'] },
  typst:         { exts: ['.typ'] },
  vim:           { exts: ['.vim'] },
  vue:           { exts: ['.vue'] },
  xml:           { exts: ['.xml', '.xsd', '.xslt', '.xsl'] },
  yaml:          { exts: ['.yaml', '.yml'] },
  zig:           { exts: ['.zig'] },
}

/** 找 node_modules 路径（兼容开发环境和打包后） */
function findModule(subPath) {
  const paths = [
    path.join(__dirname, 'node_modules', subPath),
    path.join(process.resourcesPath || '', 'node_modules', subPath),
    path.join(process.cwd(), 'node_modules', subPath),
  ]
  for (const p of paths) {
    if (fs.existsSync(p)) return p
  }
  return paths[0] // 返回第一个，留给 require 报错
}

const WASM_BASE_DIR = (() => {
  const p = findModule('tree-sitter-wasm/out')
  return fs.existsSync(p) ? p : path.join(__dirname, 'node_modules', 'tree-sitter-wasm', 'out')
})()

async function initParser() {
  try {
    const webMod = findModule('web-tree-sitter/web-tree-sitter.cjs')
    const web = require(webMod)
    ParserClass = web.Parser
    LanguageClass = web.Language

    const coreWasm = findModule('web-tree-sitter/web-tree-sitter.wasm')
    await ParserClass.init({ locateFile: () => coreWasm })

    let count = 0
    for (const lang of Object.keys(LANGUAGES)) {
      const wasmFile = path.join(WASM_BASE_DIR, lang, `tree-sitter-${lang}.wasm`)
      if (fs.existsSync(wasmFile)) {
        try {
          const wasm = fs.readFileSync(wasmFile)
          const langObj = await LanguageClass.load(wasm)
          loadedLangs.set(lang, langObj)
          count++
        } catch {}
      }
    }
    ready = true
    console.log(`✅ Tree-sitter: ${count}/${Object.keys(LANGUAGES).length} languages loaded`)
  } catch (e) {
    console.log('⚠️ Tree-sitter init failed:', e.message)
  }
}

function getParser(lang) {
  if (!ready || !loadedLangs.has(lang)) return null
  const p = new ParserClass()
  p.setLanguage(loadedLangs.get(lang))
  return p
}

const fingerprintCache = new Map()

function analyze(content, filename) {
  const issues = []
  const ext = path.extname(filename || '').toLowerCase()
  const basename = path.basename(filename || '')
  syntaxCheck(content, ext, basename, issues)
  if (content.length > 20) {
    const fp = fingerprint(content)
    duplicateCheck(fp, filename, issues)
    fingerprintCache.set(fp, { filename, content })
    if (fingerprintCache.size > 500) {
      const firstKey = fingerprintCache.keys().next().value
      fingerprintCache.delete(firstKey)
    }
  }
  return issues
}

function syntaxCheck(content, ext, basename, issues) {
  let lang = Object.entries(LANGUAGES).find(([, v]) => v.exts.includes(ext))?.[0]
  // 按文件名匹配（如 Makefile、Dockerfile、justfile）
  if (!lang) {
    lang = Object.entries(LANGUAGES).find(([, v]) => v.exts.includes(basename))?.[0]
  }

  if (lang && ready) {
    const parser = getParser(lang)
    if (parser) {
      try {
        const tree = parser.parse(content)
        if (tree.rootNode.hasError) {
          let errorLine = 1
          for (let i = 0; i < tree.rootNode.childCount; i++) {
            const child = tree.rootNode.child(i)
            if (child && child.hasError) {
              errorLine = child.startPosition.row + 1
              break
            }
          }
          issues.push({ t: 'err', text: `语法错误（第${errorLine}行）` })
        } else {
          issues.push({ t: 'ok', text: '语法通过' })
        }
        return
      } catch {}
    }
  }

  // 降级
  const opens = (content.match(/{/g) || []).length
  const closes = (content.match(/}/g) || []).length
  if (opens === 0 && closes === 0) {
    issues.push({ t: 'ok', text: '未检测语言' })
  } else if (opens === closes) {
    issues.push({ t: 'ok', text: '括号平衡' })
  } else {
    issues.push({ t: 'err', text: `花括号不匹配 (${opens}开 ${closes}闭)` })
  }
}

function fingerprint(content) {
  return content.split('\n')
    .map(l => l.replace(/\/\/.*$/, '').replace(/#.*$/, '').replace(/".*?"/g, '""').replace(/'.*?'/g, "''").trim())
    .filter(l => l.length > 0).slice(0, 15)
    .join('│').replace(/\s/g, '')
}

function duplicateCheck(fp, filename, issues) {
  if (!fp || fp.length < 30) return
  for (const [cachedFp, info] of fingerprintCache) {
    if (cachedFp === fp) {
      // 跳过自身
      if (info.filename === filename) continue
      issues.push({ t: 'warn', text: `代码重复 100%`, src: path.basename(info.filename) })
      return
    }
    const minLen = Math.min(fp.length, cachedFp.length)
    if (minLen > 40) {
      let same = 0
      for (let i = 0; i < minLen; i++) {
        if (fp[i] === cachedFp[i]) same++
        else break
      }
      const ratio = same / minLen
      if (ratio > 0.7 && same > 30) {
        // 跳过自身
        if (info.filename === filename) continue
        issues.push({ t: 'warn', text: `代码相似 ${Math.round(ratio * 100)}%`, src: path.basename(info.filename) })
        return
      }
    }
  }
}

module.exports = { analyze, initParser }
