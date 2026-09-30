// Gera ../public/storefront/nube-app.js (ESM, com __APP_URL__ para o servidor trocar).
import { build } from "esbuild";

await build({
	entryPoints: ["src/main.js"],
	bundle: true,
	format: "esm",
	minify: true,
	target: "es2020",
	legalComments: "none",
	banner: { js: "/*! Miaou: provador virtual (NubeSDK) */" },
	outfile: "../public/storefront/nube-app.js",
});
console.log("public/storefront/nube-app.js gerado");
