/**
 * Miaou na vitrine, via NubeSDK (substitui o loader.js da Script API).
 *
 * Roda num web worker da Nuvemshop, sem acesso ao DOM:
 * - página de produto: botão "Provar virtualmente" antes do "Comprar"; o
 *   provador (a mesma tela /tryon/ de sempre) abre num iframe, em modal no
 *   celular e em gaveta lateral no computador;
 * - checkout: grava no pedido (order extra) os produtos provados, cada um com
 *   o token assinado pelo servidor. Quando a Nuvemshop avisa que o pedido foi
 *   pago, o servidor lê esse campo e conta a venda.
 *
 * __APP_URL__ é trocado pelo endereço do servidor em scripts/build-loader.js.
 */
import { button, iframe } from "@tiendanube/nube-sdk-ui";

const API = "__APP_URL__";
const BUTTON_SLOT = "before_product_detail_add_to_cart";
const TRIED_KEY = "szp_tried";
const TOKEN_KEY = "szp_tok";
const VISIT_KEY = "szp_visit";
const WEEK = 7 * 864e5;
const EXTRA_KEY = "miaou";

export function App(nube) {
	const browser = nube.getBrowserAPIs();
	const local = browser.asyncLocalStorage;
	const session = browser.asyncSessionStorage;

	let current = null; // { storeId, productId, cfg, visit }
	let openSlot = null;
	let lastPage = null;

	// ---------- armazenamento (async no worker) ----------
	async function readJSON(storage, key, fallback) {
		try {
			const v = await storage.getItem(key);
			return v ? JSON.parse(v) : fallback;
		} catch {
			return fallback;
		}
	}
	async function writeJSON(storage, key, value) {
		try {
			await storage.setItem(key, JSON.stringify(value));
		} catch {
			/* sem armazenamento: segue sem lembrar */
		}
	}
	async function readTried() {
		const list = await readJSON(local, TRIED_KEY, []);
		return Array.isArray(list)
			? list.filter((r) => r && Date.now() - r.t < WEEK)
			: [];
	}
	async function rememberTried(productId, token) {
		if (!productId || !token) return;
		const list = (await readTried()).filter(
			(r) => String(r.p) !== String(productId),
		);
		list.push({ p: String(productId), k: String(token), t: Date.now() });
		await writeJSON(local, TRIED_KEY, list.slice(-10));
	}
	// id de visita aleatório (só desta aba): os relatórios contam pessoas, não cliques
	async function visitId() {
		try {
			const v = await session.getItem(VISIT_KEY);
			if (v) return v;
		} catch {
			/* noop */
		}
		const id = `v${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
		try {
			await session.setItem(VISIT_KEY, id);
		} catch {
			/* noop */
		}
		return id;
	}

	function post(path, body) {
		return fetch(API + path, {
			method: "POST",
			headers: { "Content-Type": "text/plain" },
			body: JSON.stringify(body),
			keepalive: true,
		}).catch(() => {});
	}
	function track(type) {
		if (!current?.cfg?.token) return;
		post(`/api/tryon/${current.storeId}/events`, {
			type,
			productId: current.productId,
			token: current.cfg.token,
			visitId: current.visit,
		});
	}

	function originOf(url) {
		try {
			return new URL(url).origin;
		} catch {
			return "";
		}
	}

	// ---------- provador ----------
	function closeTryon() {
		if (!openSlot) return;
		nube.clearSlot(openSlot);
		openSlot = null;
	}

	function onMessage({ value }) {
		const d = value;
		if (!d || d.source !== "mq") return;
		if (d.type === "close") closeTryon();
		else if (d.type === "tried") rememberTried(d.productId, d.token);
		else if (d.type === "buy") {
			closeTryon();
			addToCart();
		}
	}

	// Com uma só variação dá para pôr no carrinho direto; com tamanhos, o
	// cliente escolhe na página, então só fechamos o provador e avisamos.
	function addToCart() {
		const page = nube.getState().location.page;
		const variants = page?.type === "product" ? page.data.product.variants : [];
		if (variants?.length === 1) {
			nube.send("cart:add", () => ({
				cart: { items: [{ variant_id: variants[0].id, quantity: 1 }] },
			}));
			return;
		}
		nube.render("corner_top_right", {
			type: "toastRoot",
			variant: "info",
			children: [
				{ type: "toastTitle", children: "Escolha o tamanho e toque em Comprar" },
			],
		});
	}

	function openTryon() {
		if (!current || openSlot) return;
		const state = nube.getState();
		const phone = state.device.type === "mobile";
		const screen = state.device.screen;
		const product = state.location.page?.data?.product;
		const image = product?.images?.[0]?.src || current.cfg.product?.image || "";
		const q = new URLSearchParams({
			store: String(current.storeId),
			product: String(current.productId),
			visit: current.visit,
			origin: originOf(state.location.url),
			image,
			layout: "drawer",
		});
		openSlot = phone ? "modal_content" : "drawer_right";
		nube.render(
			openSlot,
			iframe({
				src: `${API}/tryon/?${q.toString()}`,
				width: "100%",
				height: Math.round(
					(screen?.innerHeight || screen?.height || 720) * (phone ? 0.85 : 1),
				),
				onMessage,
			}),
		);
	}

	// ---------- página de produto ----------
	async function onProductPage(state) {
		const storeId = state.store.id;
		const productId = state.location.page.data.product.id;
		if (current?.productId === productId) return;
		closeTryon();
		nube.clearSlot(BUTTON_SLOT);
		current = null;
		let cfg;
		try {
			const r = await fetch(
				`${API}/api/storefront/${storeId}/config?product=${encodeURIComponent(productId)}`,
			);
			if (!r.ok) throw new Error(`HTTP ${r.status}`);
			cfg = await r.json();
		} catch (err) {
			console.warn("[provador] indisponível:", err.message);
			return;
		}
		if (!cfg.enabled || !cfg.tryon?.enabled) return;
		// a página mudou enquanto a configuração chegava
		const now = nube.getState().location.page;
		if (now?.type !== "product" || now.data.product.id !== productId) return;

		current = { storeId, productId, cfg, visit: await visitId() };
		await writeJSON(local, TOKEN_KEY, { s: String(storeId), t: cfg.token });
		nube.render(
			BUTTON_SLOT,
			button({
				children: cfg.tryon.button || "Provar virtualmente",
				variant: "secondary",
				width: "100%",
				ariaLabel: "Provar virtualmente",
				onClick: openTryon,
			}),
		);
		track("tryon_view");
		// veio do link compartilhado ("Provar em mim"): abre o provador direto
		if (state.location.queries?.provar === "1") openTryon();
	}

	// ---------- checkout: liga o pedido ao provador ----------
	async function onCheckout() {
		const tried = await readTried();
		const tok = await readJSON(local, TOKEN_KEY, null);
		const storeId = String(nube.getState().store.id);
		if (!tried.length || !tok || String(tok.s) !== storeId) return;
		const value = JSON.stringify({ v: 1, p: tried.map((r) => [r.p, r.k]) });
		nube.send("order:add:extra", () => ({ order: { extra: { [EXTRA_KEY]: value } } }));
	}

	function handle(state) {
		const page = state.location.page;
		const key = `${page?.type}:${page?.type === "product" ? page.data.product.id : (page?.data?.step ?? "")}`;
		if (key === lastPage) return;
		lastPage = key;
		if (page?.type === "product") onProductPage(state);
		else {
			closeTryon();
			current = null;
			if (page?.type === "checkout") onCheckout();
		}
	}

	nube.on("page:loaded", handle);
	nube.on("location:updated", handle);
	nube.on("checkout:ready", () => onCheckout());
	// compra concluída: o pedido já leva os provados, então a lista recomeça
	nube.on("checkout:success", () => {
		writeJSON(local, TRIED_KEY, []);
	});
	handle(nube.getState());
}
