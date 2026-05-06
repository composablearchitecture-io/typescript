import { defineConfig } from 'vitest/config';
import dts from 'vite-plugin-dts';
import { resolve } from 'path';

export default defineConfig({
  plugins: [
    dts({
      entryRoot: resolve(__dirname, 'src'),
      tsconfigPath: resolve(__dirname, 'tsconfig.json'),
      outDir: 'dist',
      insertTypesEntry: true
    })
  ],
  build: {
    minify: "esbuild",
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      fileName: (format) => `index.${format === 'cjs' ? 'cjs' : 'js'}`,
      formats: ['es', 'cjs']
    },
    sourcemap: true,
    target: 'es2020',
    outDir: 'dist',
    rollupOptions: {
      external: [],
      input: resolve(__dirname, 'src/index.ts'),
      // Exclude test folder from build
      // This pattern ignores any files in src/test or src/**/test
      // Adjust as needed for your folder structure
      // Only include files outside of test folders
      // If you want to ignore more, add patterns here
      // For example: ['!src/test/**', '!src/**/test/**']
      // But since entry is set, only index.ts is built
      // If you use glob input, you can use patterns like below:
      // input: glob.sync('src/**/*.ts', { ignore: ['src/test/**'] })
    }
  },
  resolve: {
    extensions: ['.ts', '.js'],
    alias: {
      '@': resolve(__dirname, './src')
    }
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts']
  }
});
