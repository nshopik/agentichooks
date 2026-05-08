import typescript from "@rollup/plugin-typescript";
import nodeResolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";

export default {
  input: "src/plugin.ts",
  output: {
    file: "com.nshopik.claudenotify.sdPlugin/bin/plugin.js",
    format: "es",
    sourcemap: true,
  },
  external: [],
  plugins: [
    nodeResolve({ preferBuiltins: true }),
    commonjs(),
    typescript({ tsconfig: "./tsconfig.json", sourceMap: true }),
  ],
};
