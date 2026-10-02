/**
 * Miaou na vitrine, via NubeSDK (substitui o loader.js da Script API).
 *
 * Roda num web worker da Nuvemshop, sem acesso ao DOM:
 * - página de produto: botão "Provar virtualmente" (com a varinha) logo abaixo
 *   do "Comprar", depois das variações; o provador (a mesma tela /tryon/ de sempre) abre num iframe, em
 *   cartão na janela oficial (modal_content), com a foto da variação
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
	keyframes,
	styled,
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

// Varinha do botão: a mesma da espera da prova (Hugeicons Free AiBeautify,
// Stroke Rounded, MIT · Copyright (c) 2025 Hugeicons). Gira de leve e as
// estrelinhas piscam; o lojista desliga a animação em Preferências.
const WAND =
	"M14 12.6483L16.3708 10.2775C16.6636 9.98469 16.81 9.83827 16.8883 9.68032C17.0372 9.3798 17.0372 9.02696 16.8883 8.72644C16.81 8.56849 16.6636 8.42207 16.3708 8.12923C16.0779 7.83638 15.9315 7.68996 15.7736 7.61169C15.473 7.46277 15.1202 7.46277 14.8197 7.61169C14.6617 7.68996 14.5153 7.83638 14.2225 8.12923L11.8517 10.5M14 12.6483L5.77754 20.8708C5.4847 21.1636 5.33827 21.31 5.18032 21.3883C4.8798 21.5372 4.52696 21.5372 4.22644 21.3883C4.06849 21.31 3.92207 21.1636 3.62923 20.8708C3.33639 20.5779 3.18996 20.4315 3.11169 20.2736C2.96277 19.973 2.96277 19.6202 3.11169 19.3197C3.18996 19.1617 3.33639 19.0153 3.62923 18.7225L11.8517 10.5M14 12.6483L11.8517 10.5";
const SPARKS = [
	"M19.5 2.5L19.3895 2.79873C19.2445 3.19044 19.172 3.38629 19.0292 3.52917C18.8863 3.67204 18.6904 3.74452 18.2987 3.88946L18 4L18.2987 4.11054C18.6904 4.25548 18.8863 4.32796 19.0292 4.47083C19.172 4.61371 19.2445 4.80956 19.3895 5.20127L19.5 5.5L19.6105 5.20127C19.7555 4.80956 19.828 4.61371 19.9708 4.47083C20.1137 4.32796 20.3096 4.25548 20.7013 4.11054L21 4L20.7013 3.88946C20.3096 3.74452 20.1137 3.67204 19.9708 3.52917C19.828 3.38629 19.7555 3.19044 19.6105 2.79873L19.5 2.5Z",
	"M19.5 12.5L19.3895 12.7987C19.2445 13.1904 19.172 13.3863 19.0292 13.5292C18.8863 13.672 18.6904 13.7445 18.2987 13.8895L18 14L18.2987 14.1105C18.6904 14.2555 18.8863 14.328 19.0292 14.4708C19.172 14.6137 19.2445 14.8096 19.3895 15.2013L19.5 15.5L19.6105 15.2013C19.7555 14.8096 19.828 14.6137 19.9708 14.4708C20.1137 14.328 20.3096 14.2555 20.7013 14.1105L21 14L20.7013 13.8895C20.3096 13.7445 20.1137 13.672 19.9708 13.5292C19.828 13.3863 19.7555 13.1904 19.6105 12.7987L19.5 12.5Z",
	"M10.5 2.5L10.3895 2.79873C10.2445 3.19044 10.172 3.38629 10.0292 3.52917C9.88629 3.67204 9.69044 3.74452 9.29873 3.88946L9 4L9.29873 4.11054C9.69044 4.25548 9.88629 4.32796 10.0292 4.47083C10.172 4.61371 10.2445 4.80956 10.3895 5.20127L10.5 5.5L10.6105 5.20127C10.7555 4.80956 10.828 4.61371 10.9708 4.47083C11.1137 4.32796 11.3096 4.25548 11.7013 4.11054L12 4L11.7013 3.88946C11.3096 3.74452 11.1137 3.67204 10.9708 3.52917C10.828 3.38629 10.7555 3.19044 10.6105 2.79873L10.5 2.5Z",
];
const WAVE = keyframes`0%,100%{transform:rotate(-10deg)}50%{transform:rotate(12deg)}`;
const TWINKLE = keyframes`0%,100%{opacity:.15}40%{opacity:1}`;
const WavingSvg = styled(svgRoot)`
	animation: ${WAVE} 1.6s ease-in-out infinite;
	transform-origin: 20% 85%;
`;
const TWINKLES = [0, 0.6, 1.2].map(
	(delay) => styled(svgPath)`
		animation: ${TWINKLE} 1.8s ease-in-out ${delay}s infinite;
	`,
);

function wandIcon(animate) {
	const Root = animate ? WavingSvg : svgRoot;
	const line = { stroke: "currentColor", strokeWidth: 1.5, strokeLinejoin: "round" };
	return Root({
		width: 22,
		height: 22,
		viewBox: "0 0 24 24",
		fill: "none",
		style: { flexShrink: 0 },
		children: [
			svgPath({ d: WAND, ...line, strokeLinecap: "round" }),
			...SPARKS.map((d, i) => (animate ? TWINKLES[i] : svgPath)({ d, ...line })),
		],
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
		nube.clearSlot("modal_content");
		openSlot = null;
		writeJSON(session, REOPEN_KEY, null);
	}

	function toast(text) {
		nube.render("corner_top_right", {
			type: "toastRoot",
			variant: "info",
			children: [{ type: "toastTitle", children: text }],
		});
	}

	function onMessage({ value }) {
		const d = value;
		if (d?.type !== "height" && d?.type !== "drag" && d?.type !== "resize") dbg("mensagem", d);
		if (!d || d.source !== "mq") return;
		if (d.type === "close") closeTryon();
		else if (d.type === "picking" && current) {
			writeJSON(session, REOPEN_KEY, { p: current.productId, t: Date.now() });
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

	// Janela oficial (modal_content). Medido na loja real (log "overlay:visivel"):
	// a janela fica no centro e mostra no máximo 90% da largura e da altura da
	// tela menos 14 px (celular 360x668 mostrou 310x638; computador 1440x707
	// mostrou 1282x623); o que passar disso é cortado. O provador abre como um
	// cartão que cabe nesse limite.
	const MODAL = "modal_content";
	function openTryon(resume) {
		if (!current) return;
		// limpa o que tiver ficado de uma abertura anterior
		if (openSlot) nube.clearSlot(openSlot);
		const state = nube.getState();
		const phone = state.device.type === "mobile";
		const screen = state.device.screen || {};
		const vw = screen.innerWidth || screen.width || 390;
		const vh = screen.innerHeight || screen.height || 720;
		// limite da janela, com 2 px de folga
		const capW = Math.floor(vw * 0.9) - 16;
		const capH = Math.floor(vh * 0.9) - 16;
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
			layout: phone ? "modal" : "drawer",
			device: phone ? "phone" : "desktop",
			vw: String(vw),
			vh: String(vh),
			maxh: String(capH),
			n: String(++openCount),
		});
		if (variantPhoto?.id) q.set("imageId", String(variantPhoto.id));
		if (variant?.id) q.set("variantId", String(variant.id));
		if (resume === "camera") q.set("resume", "camera");
		openSlot = MODAL;
		// celular: a largura toda que a janela mostra, e a altura acompanha a tela
		// do provador (autoresize) até o limite; computador: 440 de largura
		const w = phone ? Math.min(560, capW) : Math.min(440, capW);
		const h = phone ? capH : Math.min(720, capH);
		dbg("abrir", {
			slot: openSlot, resume: resume || null, screen,
			width: w, height: h, variant: variant?.id ?? null, imageId: variantPhoto?.id ?? null,
		});
		nube.render(
			openSlot,
			iframe({
				src: `${API}/tryon/?${q.toString()}`,
				width: w,
				height: h,
				autoresize: phone,
				// sem a borda padrão do iframe, cantos arredondados
				style: {
					width: `${w}px`, minWidth: `${w}px`, height: `${h}px`, maxHeight: `${capH}px`,
					border: "0", display: "block", background: "#fff", borderRadius: "20px",
				},
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
				children: [wandIcon(cfg.tryon.animate !== false), cfg.tryon.button || "Provar virtualmente"],
				variant: "secondary",
				width: "100%",
				ariaLabel: "Provar virtualmente",
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
			openTryon("camera");
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
			if (openSlot) closeTryon();
			current = null;
			if (page?.type === "checkout") onCheckout();
		}
	}

	nube.on("page:loaded", handle);
	nube.on("location:updated", handle);
	nube.on("checkout:ready", () => onCheckout());
	// a janela fechou (clique fora, Esc ou pelo app): a loja avisa
	nube.on("custom:modal:close", () => {
		dbg("janela:fechou", null);
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
			openTryon("camera");
		}, 2500);
	});
	// compra concluída: o pedido já leva os provados, então a lista recomeça
	nube.on("checkout:success", () => {
		writeJSON(local, TRIED_KEY, []);
	});
	handle(nube.getState());
}
