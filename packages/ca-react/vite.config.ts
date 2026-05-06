import { defineConfig } from 'vite';
import { resolve } from 'path';
import dts from 'vite-plugin-dts';
import pkg from "./package.json";

export default defineConfig({
  plugins: [
    dts({
      include: ['src/**/*'],
      exclude: ['**/*.test.*', '**/*.spec.*'],
      rollupTypes: true,
    }),
  ],
  build: {
    minify: "esbuild",
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      formats: ['es', 'cjs'],
      fileName: (format) => `index.${format === 'cjs' ? 'cjs' : 'js'}`,
    },
    sourcemap: true,
    target: 'esnext',
    rollupOptions: {
      external: [
        ...Object.keys(pkg.peerDependencies ?? {}),
        /^node:.*/,                     // keep Node builtins external
      ],
    },
  },
});
