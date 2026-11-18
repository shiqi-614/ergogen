import pkg from './package.json' with { type: 'json' }
import json from '@rollup/plugin-json'
import commonjs from '@rollup/plugin-commonjs'
import terser from '@rollup/plugin-terser'


export default {
  input: 'src/ergogen.js',
  external: ['makerjs', 'js-yaml', 'mathjs', 'kle-serial', 'jszip', 'axios', 'manifold-3d'],
  // ergogen.js as written, for reading and debugging; ergogen.min.js minified (names shortened, comments but the
  // banner gone), the one ergogen-gui serves
  output: [false, true].map(min => ({
    name: 'ergogen',
    file: min ? 'dist/ergogen.min.js' : 'dist/ergogen.js',
    format: 'umd',
    banner: `/*!\n * Ergogen v${pkg.version}\n * https://ergogen.xyz\n */\n`,
    globals: {
      'makerjs': 'makerjs',
      'js-yaml': 'jsyaml',
      'mathjs': 'math',
      'kle-serial': 'kle',
      'jszip': 'jszip',
      'axios':'axios'
    },
    plugins: min ? [terser({format: {comments: /^!/}})] : [],
  })),
  plugins: [
    json(),
    commonjs()
  ]
}
