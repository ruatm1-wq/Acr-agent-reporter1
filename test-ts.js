const web = require('web-tree-sitter')
const fs = require('fs')
const path = require('path')

async function test() {
  try {
    // Just try creating a parser to init
    const parser = new web.Parser()
    console.log('Parser created OK')

    // Try loading Python WASM
    const wasmPath = path.join(__dirname, 'node_modules', 'tree-sitter-wasm', 'out', 'python', 'tree-sitter-python.wasm')
    const wasm = fs.readFileSync(wasmPath)
    console.log('WASM size:', wasm.length)

    const lang = await web.Language.load(wasm)
    console.log('Language loaded:', !!lang)

    parser.setLanguage(lang)
    const tree = parser.parse('x = 1')
    console.log('Parse OK, errors:', tree.rootNode.hasError())
  } catch (e) {
    console.log('Error:', e.message)
    console.log('Stack:', e.stack?.split('\n').slice(0,3).join('\n'))
  }
}
test()
