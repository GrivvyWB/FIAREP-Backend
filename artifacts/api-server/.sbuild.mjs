import { build } from "esbuild";
await build({ entryPoints: [process.argv[2]], bundle: true, platform: "node", format: "esm", outfile: process.argv[3], logLevel: "error",
  external: ["pg-native", "nodemailer", "imapflow", "mailparser", "pino", "pino-*", "thread-stream", "playwright*"],
  banner: { js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" } });
