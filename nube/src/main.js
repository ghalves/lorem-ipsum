/**
 * Miaou na vitrine, via NubeSDK (substitui o loader.js da Script API).
 *
 * Roda num web worker da Nuvemshop, sem acesso ao DOM:
 * - página de produto: botão "Provar em mim" (com os brilhos) logo abaixo
 *   do "Comprar", depois das variações; o provador (a mesma tela /tryon/ de sempre) abre num iframe, em
 *   gaveta oficial da loja (drawer_right), com a foto da variação
 *   escolhida; o "Comprar" do provador põe essa variação no carrinho;
 * - checkout: grava no pedido (order extra) os produtos provados, cada um com
 *   o token assinado pelo servidor. Quando a Nuvemshop avisa que o pedido foi
 *   pago, o servidor lê esse campo e conta a venda.
 *
 * __APP_URL__ é trocado pelo endereço do servidor em scripts/build-loader.js.
 */
import {
	button,
	iframe,
	svgPath,
	svgRoot,
} from "@tiendanube/nube-sdk-ui";

const API = "__APP_URL__";
// O SDK só oferece "antes" e "depois" do botão de compra. Nos temas da
// Nuvemshop o "antes" fica acima das variações (variações + Comprar são um
// bloco só): não há lugar entre as variações e o Comprar.
const BUTTON_SLOT = "before_product_detail_add_to_cart";
const TRIED_KEY = "szp_tried";
const TOKEN_KEY = "szp_tok";
const VISIT_KEY = "szp_visit";
// câmera aberta no celular: se o sistema descartar a página, reabre o provador
const REOPEN_KEY = "szp_reopen";
const REOPEN_MS = 2 * 60 * 1000;
const WEEK = 7 * 864e5;
const EXTRA_KEY = "miaou";
const PICK_OPTIONS = "Escolha as opções e toque em Comprar";

// Ícone do botão: Hugeicons Free AiSparkles (Stroke Rounded, MIT · Copyright
// (c) 2025 Hugeicons, @hugeicons/core-free-icons 4.3.5). Parado: animação que
// repete sem parar distrai na página do produto.
const SPARKLES = [
	"M11.9826 10.879L13.5745 11.4096C14.1418 11.5987 14.1418 12.4013 13.5745 12.5904L11.9826 13.121C10.8676 13.4927 9.99268 14.3676 9.62102 15.4826L9.0904 17.0745C8.90127 17.6418 8.09873 17.6418 7.9096 17.0745L7.37898 15.4826C7.00732 14.3676 6.13239 13.4927 5.0174 13.121L3.42553 12.5904C2.85815 12.4013 2.85816 11.5987 3.42553 11.4096L5.0174 10.879C6.13239 10.5073 7.00732 9.63239 7.37898 8.5174L7.9096 6.92553C8.09873 6.35815 8.90127 6.35816 9.0904 6.92553L9.62102 8.5174C9.99268 9.63239 10.8676 10.5073 11.9826 10.879Z",
	"M18.083 4.99045L18.8066 5.23164C19.0645 5.3176 19.0645 5.6824 18.8066 5.76836L18.083 6.00955C17.5762 6.17849 17.1785 6.57619 17.0096 7.083L16.7684 7.80658C16.6824 8.06448 16.3176 8.06447 16.2316 7.80658L15.9904 7.083C15.8215 6.57619 15.4238 6.17849 14.917 6.00955L14.1934 5.76836C13.9355 5.6824 13.9355 5.3176 14.1934 5.23164L14.917 4.99045C15.4238 4.82151 15.8215 4.42381 15.9904 3.917L16.2316 3.19342C16.3176 2.93552 16.6824 2.93553 16.7684 3.19342L17.0096 3.917C17.1785 4.42381 17.5762 4.82151 18.083 4.99045Z",
	"M18.083 17.9904L18.8066 18.2316C19.0645 18.3176 19.0645 18.6824 18.8066 18.7684L18.083 19.0096C17.5762 19.1785 17.1785 19.5762 17.0096 20.083L16.7684 20.8066C16.6824 21.0645 16.3176 21.0645 16.2316 20.8066L15.9904 20.083C15.8215 19.5762 15.4238 19.1785 14.917 19.0096L14.1934 18.7684C13.9355 18.6824 13.9355 18.3176 14.1934 18.2316L14.917 17.9904C15.4238 17.8215 15.8215 17.4238 15.9904 16.917L16.2316 16.1934C16.3176 15.9355 16.6824 15.9355 16.7684 16.1934L17.0096 16.917C17.1785 17.4238 17.5762 17.8215 18.083 17.9904Z",
];
function sparklesIcon() {
	const line = { stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" };
	return svgRoot({
		width: 22,
		height: 22,
		viewBox: "0 0 24 24",
		fill: "none",
		style: { flexShrink: 0 },
		children: SPARKLES.map((d) => svgPath({ d, ...line })),
	});
}

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
	// Diagnóstico (TRYON_DEBUG=true no servidor): conta para o log o que
	// acontece na loja real, onde não temos o console do navegador
	// O worker nasce a cada página: até a configuração chegar não se sabe se o
	// debug está ligado, então o que acontecer antes fica numa fila curta.
	let debugOn = null;
	const debugQueue = [];
	function sendDbg(event, data) {
		const storeId = nube.getState().store?.id;
		post(`/api/tryon/${storeId}/debug`, { from: "loja", event, data });
	}
	function dbg(event, data) {
		if (debugOn) return sendDbg(event, data);
		if (debugOn === null && debugQueue.length < 20) debugQueue.push([event, { ...data, antesDaConfig: true }]);
	}
	function setDebug(on) {
		debugOn = Boolean(on);
		const queued = debugQueue.splice(0);
		if (debugOn) for (const [e, d] of queued) sendDbg(e, d);
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

	// ---------- variação escolhida na página ----------
	// A prova usa a foto da variação (cor) e o "Comprar" põe essa variação no
	// carrinho, só depois que o cliente escolhe. O tema avisa a variação marcada
	// por padrão ao carregar a página, antes de o botão do provador aparecer
	// (log da loja real: variação marcada sem o cliente tocar); esse aviso não é
	// escolha do cliente.
	let selectedVariantId = null;
	let warnedPayload = false;

	function pageProduct() {
		const page = nube.getState().location.page;
		return page?.type === "product" ? page.data.product : null;
	}
	// Foto da prova e "Comprar": só a variação que o cliente escolheu. O tema
	// marca uma por padrão (ex.: P / Amarelo), mas isso não é escolha dele.
	function chosenVariant() {
		const variants = pageProduct()?.variants || [];
		return variants.find((v) => v.id === selectedVariantId) || null;
	}
	// o formato do aviso não é documentado: aceita os nomes mais prováveis
	function variantIdFrom(payload) {
		const p = payload || {};
		for (const v of [p.variant?.id, p.variant_id, p.variantId, p.selected_variant?.id, p.id]) {
			const n = Number(v);
			if (Number.isSafeInteger(n) && n > 0) return n;
		}
		return null;
	}

	// ---------- provador ----------
	let openCount = 0;

	// fecha sempre: o aviso de "janela fechou" pode chegar depois de uma reabertura
	function closeTryon() {
		if (openSlot) nube.clearSlot(openSlot);
		openSlot = null;
		writeJSON(session, REOPEN_KEY, null);
	}

	function toast(text) {
		nube.render("corner_top_right", {
			type: "toastRoot",
			variant: "info",
			duration: 6000,
			style: { maxWidth: "calc(100vw - 32px)", whiteSpace: "normal" },
			children: [{ type: "toastTitle", children: text }],
		});
	}

	function onMessage({ value }) {
		const d = value;
		if (d?.type !== "height" && d?.type !== "drag" && d?.type !== "resize") dbg("mensagem", d);
		if (!d || d.source !== "mq") return;
		if (d.type === "close") closeTryon();
		else if (d.type === "picking" && current) {
			// câmera ou galeria: o aviso depois de recarregar muda conforme o caso
			writeJSON(session, REOPEN_KEY, { p: current.productId, t: Date.now(), c: d.campo === "fileCamera" ? "camera" : "gallery" });
		} else if (d.type === "picked") writeJSON(session, REOPEN_KEY, null);
		else if (d.type === "tried") rememberTried(d.productId, d.token);
		else if (d.type === "buy") {
			closeTryon();
			addToCart();
		}
	}

	// "Comprar" do provador: vai para o carrinho a variação que o cliente escolheu
	// (a mesma da prova). Sem escolha, não compra a opção que o tema marcou por
	// padrão (outra cor da provada): fecha e pede para escolher as opções.
	let addingToCart = false;
	function pickOptionsText() {
		const names = (pageProduct()?.attributes || [])
			.map((a) => (typeof a === "string" ? a : a?.pt || a?.es || a?.en || ""))
			.filter(Boolean)
			.map((n) => n.toLowerCase());
		if (!names.length) return PICK_OPTIONS;
		const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} e ${names.at(-1)}` : names[0];
		return `Escolha ${list} e toque em Comprar`;
	}
	function addToCart() {
		const variants = pageProduct()?.variants || [];
		const variant = variants.length === 1 ? variants[0] : chosenVariant();
		if (!variant) return toast(pickOptionsText());
		addingToCart = true;
		// a documentação (Events > Cart > cart:add) pede variant_id, product_id e quantity
		const productId = pageProduct()?.id;
		dbg("carrinho:enviar", { variant_id: variant.id, product_id: productId });
		nube.send("cart:add", () => ({
			cart: { items: [{ variant_id: variant.id, product_id: productId, quantity: 1 }] },
		}));
	}

	// VERSÃO DE MEDIÇÃO (loja demo): slot corner_bottom_left (Slots > Fixed
	// slots: position fixed, sem tamanho máximo listado) com o iframe do tamanho
	// da tela e fundo transparente. O provador desenha o fundo escuro e o card
	// (sobe de baixo no celular, gaveta flutuante no computador) e registra no
	// log o que a loja mostrou (janela:visivel). Aguarda a Nuvemshop confirmar
	// que o uso é aceito; a versão oficial usa drawer_right.
	const DRAWER = "drawer_right";
	// medido na loja: o canto limita a largura a 45% da tela e, preso à direita,
	// o resto do iframe ia para fora da tela; preso à esquerda, o iframe se
	// estende para a direita a partir da borda da tela
	const CORNER = "corner_bottom_left";
	function openTryon(resume) {
		if (!current) return;
		// limpa o que tiver ficado de uma abertura anterior
		if (openSlot) nube.clearSlot(openSlot);
		const state = nube.getState();
		const phone = state.device.type === "mobile";
		const screen = state.device.screen || {};
		const vw = screen.innerWidth || screen.width || 390;
		const vh = screen.innerHeight || screen.height || 720;
		const product = state.location.page?.data?.product;
		const variant = chosenVariant();
		// na loja real as variações vêm sem image_id: o servidor acha a foto da
		// cor pelo id da variação (dados da API)
		const variantPhoto = product?.images?.find((i) => i.id === variant?.image_id);
		const photo = variantPhoto || product?.images?.[0];
		const q = new URLSearchParams({
			store: String(current.storeId),
			product: String(current.productId),
			visit: current.visit,
			origin: originOf(state.location.url),
			image: photo?.src || current.cfg.product?.image || "",
			layout: "overlay",
			slot: "corner",
			device: phone ? "phone" : "desktop",
			vw: String(vw),
			vh: String(vh),
			n: String(++openCount),
		});
		if (variantPhoto?.id) q.set("imageId", String(variantPhoto.id));
		if (variant?.id) q.set("variantId", String(variant.id));
		if (resume === "camera" || resume === "gallery") q.set("resume", resume);
		openSlot = CORNER;
		if (!resume) track("tryon_open");
		dbg("abrir", { slot: openSlot, resume: resume || null, screen, width: vw, height: vh, variant: variant?.id ?? null });
		nube.render(
			openSlot,
			iframe({
				src: `${API}/tryon/?${q.toString()}`,
				width: vw,
				height: vh,
				style: { width: `${vw}px`, minWidth: `${vw}px`, height: `${vh}px`, border: "0", display: "block", background: "transparent" },
				onMessage,
			}),
		);
	}

	// ---------- página de produto ----------
	async function onProductPage(state) {
		const storeId = state.store.id;
		const productId = state.location.page.data.product.id;
		if (current?.productId === productId) return;
		// troca de produto: some com o provador aberto, mas sem apagar a anotação
		// da câmera (a página pode ter acabado de recarregar com ela aberta)
		if (openSlot) {
			nube.clearSlot(openSlot);
			openSlot = null;
		}
		nube.clearSlot(BUTTON_SLOT);
		current = null;
		selectedVariantId = null;
		// falha de rede: tenta de novo (sem isso o botão só voltava recarregando)
		let cfg;
		let lastErr;
		for (const wait of [0, 1000, 3000, 6000]) {
			if (wait) await new Promise((r) => setTimeout(r, wait));
			const page = nube.getState().location.page;
			if (page?.type !== "product" || page.data.product.id !== productId) return;
			try {
				const r = await fetch(
					`${API}/api/storefront/${storeId}/config?product=${encodeURIComponent(productId)}`,
				);
				if (r.status >= 400 && r.status < 500) throw Object.assign(new Error(`HTTP ${r.status}`), { final: true });
				if (!r.ok) throw new Error(`HTTP ${r.status}`);
				cfg = await r.json();
				break;
			} catch (err) {
				lastErr = err;
				if (err.final) break;
			}
		}
		if (!cfg) {
			console.warn("[provador] indisponível:", lastErr?.message);
			return;
		}
		setDebug(cfg.debug);
		if (lastErr) dbg("config:tentativas", { erro: String(lastErr.message) });
		if (!cfg.enabled || !cfg.tryon?.enabled) return;
		// todas as variações esgotadas (stock 0 com controle de estoque): sem botão,
		// se o lojista deixou marcado. Sem controle de estoque = estoque infinito.
		const pv = state.location.page.data.product.variants || [];
		const soldOut = pv.length > 0 && pv.every((v) => v.stock_management !== false && v.stock != null && Number(v.stock) <= 0);
		if (soldOut && cfg.tryon.hideOutOfStock !== false) {
			dbg("sem-estoque", { produto: productId, variacoes: pv.length });
			return;
		}
		// a página mudou enquanto a configuração chegava
		const now = nube.getState().location.page;
		if (now?.type !== "product" || now.data.product.id !== productId) return;

		current = { storeId, productId, cfg, visit: await visitId() };
		const pp = state.location.page.data.product;
		dbg("produto", {
			id: productId, device: state.device,
			variants: (pp.variants || []).map((v) => ({ id: v.id, image_id: v.image_id })),
			images: (pp.images || []).map((i) => i.id),
		});
		await writeJSON(local, TOKEN_KEY, { s: String(storeId), t: cfg.token });
		nube.render(
			BUTTON_SLOT,
			button({
				children: cfg.tryon.icon === false
					? [cfg.tryon.button || "Provar em mim"]
					: [sparklesIcon(), cfg.tryon.button || "Provar em mim"],
				variant: "secondary",
				width: "100%",
				ariaLabel: cfg.tryon.button || "Provar em mim",
				style: { display: "flex", alignItems: "center", justifyContent: "center", gap: "10px" },
				onClick: () => openTryon(),
			}),
		);
		track("tryon_view");
		// a página recarregou com a câmera aberta (celular): volta ao provador
		const reopen = await readJSON(session, REOPEN_KEY, null);
		dbg("reabrir:checar", { reopen, idadeMs: reopen ? Date.now() - reopen.t : null });
		if (reopen && reopen.p === productId && Date.now() - reopen.t < REOPEN_MS) {
			await writeJSON(session, REOPEN_KEY, null);
			openTryon(reopen.c || "camera");
			return;
		}
		// veio do link compartilhado ("Provar em mim"): abre o provador direto
		if (state.location.queries?.provar === "1") openTryon();
	}

	// ---------- checkout: liga o pedido ao provador ----------
	async function onCheckout() {
		const tried = await readTried();
		const tok = await readJSON(local, TOKEN_KEY, null);
		const storeId = String(nube.getState().store.id);
		// no checkout não há página de produto: só busca a configuração para saber
		// se o diagnóstico está ligado
		if (debugOn === null) {
			try {
				const r = await fetch(`${API}/api/storefront/${storeId}/config`);
				if (r.ok) setDebug((await r.json()).debug);
			} catch {
				setDebug(false);
			}
		}
		const step = nube.getState().location.page?.data?.step ?? null;
		if (step === "success" && nube.getState().order) onOrderDone(nube.getState(), "success");
		if (!tried.length || !tok || String(tok.s) !== storeId) {
			dbg("checkout", { step, provados: tried.length, token: Boolean(tok), enviado: false });
			return;
		}
		const value = JSON.stringify({ v: 1, p: tried.map((r) => [r.p, r.k]) });
		nube.send("order:add:extra", () => ({ order: { extra: { [EXTRA_KEY]: value } } }));
		dbg("checkout", { step, provados: tried.map((r) => r.p), enviado: true });
	}

	// Página de sucesso: o pedido concluído chega no order:update (Events > Order,
	// o exemplo oficial lê order.id). O order.extra só fica visível nesta página,
	// não no pedido da API, então o número do pedido e os provados vão para o
	// servidor, que conta a venda quando a Nuvemshop avisar o pagamento.
	const sentOrders = new Set();
	async function onOrderDone(state, origem) {
		const order = state.order || {};
		const payload = state.eventPayload || {};
		// Medido na loja real: o pedido desta página não traz id; o id do carrinho é
		// o número do pedido e aparece também no endereço (/checkout/v3/success/<id>/).
		// Só vale quando os dois batem.
		const fromUrl = String(state.location?.url || "").match(/\/success\/(\d+)(?:\/|$|\?)/)?.[1];
		const fromCart = state.cart?.id != null ? String(state.cart.id) : null;
		const raw = order.id ?? (fromUrl && fromUrl === fromCart ? fromCart : null);
		const orderId = Number(raw);
		const tried = await readTried();
		const tok = await readJSON(local, TOKEN_KEY, null);
		const storeId = String(state.store.id);
		// o pedido da página de sucesso não traz id (loja real): registra as outras
		// fontes possíveis para ligar esta página ao pedido pago
		dbg("pedido:concluido", {
			origem, orderId: raw ?? null, chavesPedido: Object.keys(order), payload,
			url: state.location?.url ?? null, queries: state.location?.queries ?? null,
			carrinho: state.cart ? { id: state.cart.id ?? null, chaves: Object.keys(state.cart) } : null,
			sessao: state.session?.id ?? null, provados: tried.length,
		});
		if (!Number.isSafeInteger(orderId) || orderId <= 0 || sentOrders.has(orderId)) return;
		if (!tried.length || !tok || String(tok.s) !== storeId) return;
		sentOrders.add(orderId);
		// os provados já foram ligados a este pedido: a lista recomeça
		writeJSON(local, TRIED_KEY, []);
		post(`/api/storefront/${storeId}/conversion`, {
			token: tok.t,
			orderId,
			tried: tried.map((r) => ({ productId: Number(r.p), token: r.k })),
		});
		dbg("pedido:enviado", { orderId, provados: tried.map((r) => r.p) });
	}

	function handle(state) {
		const page = state.location.page;
		const key = `${page?.type}:${page?.type === "product" ? page.data.product.id : (page?.data?.step ?? "")}`;
		if (key === lastPage) return;
		lastPage = key;
		if (page?.type === "product") onProductPage(state);
		else {
			if (openSlot) closeTryon();
			current = null;
			if (page?.type === "checkout") onCheckout();
		}
	}

	nube.on("page:loaded", handle);
	nube.on("location:updated", handle);
	nube.on("checkout:ready", () => onCheckout());
	nube.on("order:update", (state) => onOrderDone(state, "order:update"));
	// a gaveta fechou (pela loja ou pelo app): a loja avisa
	nube.on("custom:drawer:close", (state) => {
		dbg("gaveta:fechou", state.eventPayload ?? null);
		openSlot = null;
	});
	nube.on("product:variant_selected", (state) => {
		const id = variantIdFrom(state.eventPayload);
		const pp = state.location.page?.data?.product;
		dbg("variacao", {
			payload: state.eventPayload ?? null, reconhecido: id, botaoVisivel: Boolean(current),
			chavesProduto: pp ? Object.keys(pp) : null,
		});
		if (id && !current) dbg("variacao:padrao-do-tema", { id });
		else if (id) selectedVariantId = id;
		else if (!warnedPayload) {
			warnedPayload = true;
			console.warn("[provador] variação sem id reconhecido:", JSON.stringify(state.eventPayload ?? null));
		}
	});
	nube.on("cart:add:success", (state) => {
		dbg("carrinho:ok", state.eventPayload ?? null);
		if (!addingToCart) return;
		addingToCart = false;
		nube.send("cart:open");
	});
	nube.on("cart:add:fail", (state) => {
		dbg("carrinho:falhou", state.eventPayload ?? null);
		if (!addingToCart) return;
		addingToCart = false;
		toast(pickOptionsText());
	});
	// Câmera no celular sem recarregar a página: a loja pode ter fechado a janela.
	// Só vale quando a câmera foi aberta antes de a página sair da frente e,
	// ao voltar, a foto não chegou ao provador (o aviso "picked" não veio).
	// (Antes, um temporizador antigo recriava o provador com a câmera aberta.)
	let hiddenAt = 0;
	let visibleTimer = null;
	nube.on("page:visibility_change", (state) => {
		const p = state.eventPayload || {};
		dbg("visibilidade", p);
		clearTimeout(visibleTimer);
		if (p.visibilityState === "hidden" || p.hidden === true) {
			hiddenAt = Date.now();
			return;
		}
		if (p.visibilityState !== "visible" && p.visible !== true) return;
		const leftAt = hiddenAt;
		visibleTimer = setTimeout(async () => {
			const reopen = await readJSON(session, REOPEN_KEY, null);
			if (!reopen || !current || reopen.p !== current.productId) return;
			if (!(reopen.t <= leftAt) || Date.now() - reopen.t > REOPEN_MS) return;
			const stillOpen = Boolean(openSlot && nube.getState().ui?.slots?.[openSlot]);
			dbg("reabrir:checar-volta", { reopen, janelaAberta: stillOpen });
			if (stillOpen) return; // a janela continua aberta: a câmera foi só cancelada
			dbg("reabrir:voltou", reopen);
			await writeJSON(session, REOPEN_KEY, null);
			openTryon(reopen.c || "camera");
		}, 2500);
	});
	// compra concluída: liga os provados ao pedido (veja onOrderDone)
	nube.on("checkout:success", (state) => onOrderDone(state, "checkout:success"));
	handle(nube.getState());
}
