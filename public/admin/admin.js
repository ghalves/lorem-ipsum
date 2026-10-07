/* Painel do lojista: SPA sem dependências. */
(function () {
  'use strict';

  // ---------- sessão ----------
  var m = location.hash.match(/session=([^&]+)/);
  if (m) {
    try { sessionStorage.setItem('szp_session', m[1]); } catch (e) { /* noop */ }
    history.replaceState(null, '', location.pathname);
  }
  var TOKEN = m ? m[1] : (function () { try { return sessionStorage.getItem('szp_session'); } catch (e) { return null; } })();

  var view = document.getElementById('view');
  var state = { me: null };
  var closeNav = function () {};   // fecha a gaveta do celular (definida em chrome(), lá embaixo)

  // ---------- helpers ----------
  function h(tag, attrs) {
    var el = document.createElement(tag);
    for (var k in attrs || {}) {
      var v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = !!v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (var i = 2; i < arguments.length; i++) add(el, arguments[i]);
    return el;
  }
  function add(el, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { add(el, x); }); return; }
    el.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
  }
  function api(method, path, body) {
    return fetch('/api/admin' + path, {
      method: method,
      headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (r) {
      return r.json().then(function (j) {
        if (r.status === 401) { showExpired(); throw new Error(j.error); }
        if (!r.ok) throw new Error(j.error || 'Erro');
        return j;
      });
    });
  }
  var toastTimer;
  function toast(msg, isErr) {
    var t = document.getElementById('toast');
    t.textContent = msg;
    t.className = 'toast show' + (isErr ? ' err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = 'toast'; }, 3200);
  }
  function fail(e) { toast(e.message || 'Erro', true); }
  // cabeçalho de página: título e subtítulo curto à esquerda, ferramentas à direita
  // (sub pode ser um texto ou um elemento, como o "Atualizado…" da Visão geral)
  function pageHead(title, sub, tools) {
    return h('div', { class: 'page-head' },
      h('div', { class: 'tt' }, h('h1', { text: title }), sub ? (sub.nodeType ? sub : h('p', { class: 'sub', text: sub })) : null),
      tools ? h('div', { class: 'tools' }, tools) : null);
  }

  // Cores com significado (as mesmas em todo o painel):
  // rosa = uso do provador, verde = dinheiro. Hex direto porque vão em atributos SVG.
  var C = { provas: '#f5286a', pessoas: '#f97aa0', vendas: '#22c55e', receita: '#15803d' };

  // "Atualizado neste instante." só vale logo depois de os números chegarem.
  // Com a tela aberta, a frase envelhece sozinha ("Atualizado há 5 min."), para nunca mentir.
  var fresh = { timer: null, at: 0, el: null };
  function freshText(ms) {
    var min = Math.floor(ms / 60000);
    if (min < 1) return 'Atualizado neste instante.';
    if (min < 60) return 'Atualizado há ' + min + ' min.';
    var hr = Math.floor(min / 60);
    return 'Atualizado há ' + hr + ' h.';
  }
  function paintFresh() { if (fresh.el && fresh.at) fresh.el.textContent = freshText(Date.now() - fresh.at); }
  function startFresh(el) { stopFresh(); fresh.el = el; fresh.at = 0; }
  function markFresh() { fresh.at = Date.now(); paintFresh(); clearInterval(fresh.timer); fresh.timer = setInterval(paintFresh, 15000); }
  function stopFresh() { clearInterval(fresh.timer); fresh.timer = null; fresh.el = null; fresh.at = 0; }
  // voltar para a aba do navegador: corrige a frase na hora (o intervalo pode ter sido pausado)
  document.addEventListener('visibilitychange', function () { if (!document.hidden) paintFresh(); });
  // Ícones: Hugeicons Free (Stroke Rounded), carregados de icons.js.
  var ICON = window.VIBE_ICONS || {};
  function icon(name) {
    var sp = document.createElement('span');
    sp.innerHTML = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">' + (ICON[name] || '') + '</svg>';
    return sp.firstChild;
  }
  var NS = 'http://www.w3.org/2000/svg';
  function svgEl(tag, attrs) {
    var el = document.createElementNS(NS, tag);
    for (var k in attrs || {}) el.setAttribute(k, attrs[k]);
    return el;
  }
  function nf(n) { return Number(n || 0).toLocaleString('pt-BR'); }

  // ---- números com micro-gráfico (padrão "rótulo · numeral leve · variação") ----
  // Sparkline: área suave + linha de 2px, sem eixos nem rótulos, só a forma.
  function sparkline(values, color) {
    var W = 96, H = 34, n = values.length;
    var svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'presentation' });
    if (n < 2) return svg;
    var max = Math.max.apply(null, values.concat([1]));
    var x = function (i) { return (i / (n - 1)) * W; };
    var y = function (v) { return H - 3 - (v / max) * (H - 7); };
    var d = values.map(function (v, i) { return (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1); }).join(' ');
    svg.appendChild(svgEl('path', { d: d + ' L' + W + ' ' + H + ' L0 ' + H + ' Z', fill: color, 'fill-opacity': '.12', stroke: 'none' }));
    svg.appendChild(svgEl('path', { d: d, fill: 'none', stroke: color, 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
    return svg;
  }
  // cartão de número: rótulo com a bolinha da cor da métrica, valor, micro-gráfico,
  // variação contra o período anterior (verde sobe, vermelho cai) e uma nota
  function kpi(o) {
    var box = h('div', { class: 'kpi', style: '--k:' + o.color },
      h('div', { class: 'k-lab' }, h('span', { class: 'k-txt', text: o.label }), o.help ? h('span', { class: 'k-help', title: o.help, text: '?' }) : null),
      h('div', { class: 'k-val' }, o.cur ? h('span', { class: 'cur', text: o.cur }) : null, o.value));
    if (o.delta) {
      box.appendChild(h('div', { class: 'k-delta' + (o.delta.up === true ? ' up' : o.delta.up === false ? ' down' : '') },
        o.delta.b ? h('b', { text: o.delta.b }) : null, o.delta.text));
    }
    if (o.note) box.appendChild(h('div', { class: 'k-note', text: o.note }));
    if (o.series && o.series.length > 1) {
      var sp = h('div', { class: 'k-spark' });
      sp.appendChild(sparkline(o.series, o.color));
      box.appendChild(sp);
    }
    return box;
  }
  function kpiRow(items) { return h('div', { class: 'kpi-row' }, items.map(kpi)); }

  // ---- gráfico de linhas (duas séries, um único eixo) ----
  // Eixo único de propósito: as duas séries são contagens comparáveis, então
  // dois eixos distorceriam a leitura. Identidade vem da legenda + cor.
  function lineChart(rows, series, fmtX) {
    if (!rows.length) return h('p', { class: 'chart-empty', text: 'Sem dados no período.' });
    var W = 960, H = 250, padL = 44, padR = 16, padT = 14, padB = 30;
    var max = 1;
    rows.forEach(function (r) { series.forEach(function (se) { max = Math.max(max, Number(r[se.key]) || 0); }); });
    var ticks = 4, step = Math.max(1, Math.ceil(max / ticks));
    var top = step * ticks;
    var x = function (i) { return padL + (rows.length === 1 ? (W - padL - padR) / 2 : (i / (rows.length - 1)) * (W - padL - padR)); };
    var y = function (v) { return padT + (1 - v / top) * (H - padT - padB); };

    var svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': 'Uso do provador no período' });
    for (var t = 0; t <= ticks; t++) {
      var vy = y(step * t);
      svg.appendChild(svgEl('line', { x1: padL, x2: W - padR, y1: vy, y2: vy, class: 'g-line' }));
      var lab = svgEl('text', { x: padL - 10, y: vy + 4, class: 'g-txt', 'text-anchor': 'end' });
      lab.textContent = nf(step * t);
      svg.appendChild(lab);
    }
    series.forEach(function (se) {
      var d = rows.map(function (r, i) { return (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(Number(r[se.key]) || 0).toFixed(1); }).join(' ');
      if (rows.length === 1) {
        svg.appendChild(svgEl('circle', { cx: x(0), cy: y(Number(rows[0][se.key]) || 0), r: 4, fill: se.color }));
      } else {
        svg.appendChild(svgEl('path', { d: d, fill: 'none', stroke: se.color, 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
      }
    });
    var nX = Math.min(rows.length, 6);
    for (var k = 0; k < nX; k++) {
      var i = nX === 1 ? 0 : Math.round(k * (rows.length - 1) / (nX - 1));
      var tx = svgEl('text', { x: x(i), y: H - 8, class: 'g-txt', 'text-anchor': k === 0 ? 'start' : k === nX - 1 ? 'end' : 'middle' });
      tx.textContent = fmtX(rows[i]);
      svg.appendChild(tx);
    }
    // camada de leitura: linha-guia + balão com os valores do dia
    var guide = svgEl('line', { y1: padT, y2: H - padB, class: 'g-line', stroke: 'var(--muted)', opacity: '0' });
    svg.appendChild(guide);
    var dots = series.map(function (se) {
      var c = svgEl('circle', { r: 4.5, fill: se.color, stroke: '#fff', 'stroke-width': '2', opacity: '0' });
      svg.appendChild(c); return c;
    });
    var tip = h('div', { class: 'chart-tip', hidden: true });
    var wrap = h('div', { class: 'chart' });
    wrap.appendChild(svg);
    wrap.appendChild(tip);
    svg.addEventListener('mousemove', function (ev) {
      var b = svg.getBoundingClientRect();
      var px = (ev.clientX - b.left) / b.width * W;
      var i = Math.max(0, Math.min(rows.length - 1, Math.round((px - padL) / ((W - padL - padR) / Math.max(1, rows.length - 1)))));
      guide.setAttribute('x1', x(i)); guide.setAttribute('x2', x(i)); guide.setAttribute('opacity', '.35');
      dots.forEach(function (c, j) { c.setAttribute('cx', x(i)); c.setAttribute('cy', y(Number(rows[i][series[j].key]) || 0)); c.setAttribute('opacity', '1'); });
      tip.innerHTML = '';
      add(tip, [h('b', { text: fmtX(rows[i]) }), series.map(function (se) {
        return h('span', null, h('i', { style: 'background:' + se.color }), se.label + ': ' + nf(rows[i][se.key]));
      })]);
      tip.hidden = false;
      tip.style.left = Math.max(0, Math.min(b.width - 150, (x(i) / W) * b.width - 75)) + 'px';
    });
    svg.addEventListener('mouseleave', function () {
      guide.setAttribute('opacity', '0');
      dots.forEach(function (c) { c.setAttribute('opacity', '0'); });
      tip.hidden = true;
    });
    return h('div', null,
      h('div', { class: 'chart-legend' }, series.map(function (se) {
        return h('span', null, h('i', { style: 'background:' + se.color }), se.label);
      })), wrap);
  }

  // no celular, as ferramentas do topo viram só o ícone (o nome fica no title e no aria-label)
  function chipBtn(label, iconName, onclick) {
    return h('button', { class: 'chip-btn', type: 'button', onclick: onclick, title: label, 'aria-label': label },
      iconName ? icon(iconName) : null, h('span', { class: 'lbl', text: label }));
  }
  /** '1 prova' / '3 provas' */
  function pl(n, one, many) { return nf(n) + ' ' + (Number(n) === 1 ? one : many); }
  function pct(x) { return x == null ? 'sem dados' : Math.round(x * 100) + '%'; }
  function fmtDate(s) { if (!s) return 'nunca'; var d = new Date(s.replace(' ', 'T') + (s.indexOf('Z') < 0 && s.indexOf('+') < 0 ? 'Z' : '')); return d.toLocaleString('pt-BR'); }
  function showExpired() {
    // ambiente de teste (/dev ligado): entra de novo na loja demo em vez de travar
    if (!m) {
      fetch('/dev/ping').then(function (r) { if (r.ok) location.replace('/dev/login'); else paintExpired(); }).catch(paintExpired);
      return;
    }
    paintExpired();
  }
  function paintExpired() {
    view.innerHTML = '';
    add(view, h('div', { class: 'card empty' }, h('h2', { text: 'Sessão expirada' }),
      h('p', { text: 'Abra o app novamente pelo painel da sua loja Nuvemshop.' })));
  }

  // ---------- tabelas no celular ----------
  // Cada célula recebe o nome da coluna (data-label); no celular o CSS mostra
  // cada linha como um cartão, com o rótulo acima do valor.
  function stackTable(tbl) {
    var ths = Array.prototype.map.call(tbl.querySelectorAll('thead th'), function (th) { return th.textContent.trim(); });
    Array.prototype.forEach.call(tbl.querySelectorAll('tbody tr'), function (tr) {
      var main = false;
      Array.prototype.forEach.call(tr.children, function (td, i) {
        if (!ths[i]) return;
        if (!main) { td.classList.add('st-main'); main = true; return; }
        td.setAttribute('data-label', ths[i]);
      });
    });
    tbl.classList.add('stack');
  }
  new MutationObserver(function () {
    Array.prototype.forEach.call(view.querySelectorAll('table.t:not(.stack)'), stackTable);
  }).observe(view, { childList: true, subtree: true });

  // ---------- abas ----------
  var tabs = document.getElementById('tabs');
  tabs.addEventListener('click', function (e) {
    var b = e.target.closest('[data-tab]');
    if (b) go(b.getAttribute('data-tab'));
  });
  function go(tab) {
    Array.prototype.forEach.call(tabs.children, function (b) { b.setAttribute('aria-selected', String(b.getAttribute('data-tab') === tab)); });
    stopFresh();
    closeNav();
    view.innerHTML = '';
    ({ tryon: renderTryon, leads: renderLeads, prefs: renderPrefs, plan: renderPlan, products: renderProducts })[tab]();
  }

  // ---------- provador virtual ----------
  var MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  function brl(n, cents) { return Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 }); }
  function fmtPhone(p) {
    var d = String(p || '').replace(/^\+55/, '');
    return d.length === 11 ? '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7)
      : d.length === 10 ? '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6) : p;
  }
  // dia em que a cota renova (todo mês no dia em que o plano foi ativado)
  function renewDate(q) {
    var d = q && q.renewsAt ? new Date(q.renewsAt) : null;
    if (!d || isNaN(d)) { var n = new Date(); d = new Date(n.getFullYear(), n.getMonth() + 1, 1); }
    return d;
  }
  function renewText(q) { var d = renewDate(q); return (d.getDate() === 1 ? '1º' : d.getDate()) + ' de ' + MONTHS[d.getMonth()]; }
  function downloadLeads() {
    fetch('/api/admin/tryon/leads.csv', { headers: { Authorization: 'Bearer ' + TOKEN } }).then(function (r) {
      if (!r.ok) throw new Error('Não deu para baixar agora');
      return r.blob();
    }).then(function (b) {
      var a = h('a', { href: URL.createObjectURL(b), download: 'leads-provador.csv' });
      document.body.appendChild(a); a.click(); a.remove();
    }).catch(fail);
  }
  // aviso curto da cota; a troca de plano fica na aba Planos
  function quotaBanner(q) {
    var usedPct = q.plan.quota ? Math.min(1, q.used / q.plan.quota) : 0;
    var title, text, cls = 'banner';
    if (q.plan.key === 'none') { title = 'Escolha um plano para o provador aparecer na loja'; text = 'Sem plano, o botão do provador fica escondido.'; }
    else if (q.exhausted) { title = 'As provas do mês acabaram'; text = 'O botão saiu da loja até ' + renewText() + '. Suba de plano para voltar agora.'; cls += ' bad'; }
    else if (q.alert) { title = 'Você já usou ' + pct(usedPct) + ' das provas do mês'; text = 'Quando acabar, o botão sai da loja até ' + renewText() + '.'; cls += ' warn'; }
    else return null;
    return h('div', { class: cls }, icon('alert'), h('div', { class: 'banner-t' }, h('b', { text: title }), h('span', { text: text })),
      h('button', { class: 'btn sm primary', type: 'button', onclick: function () { go('plan'); } }, 'Ver planos', icon('arrow-right')));
  }
  function barList(rows) {
    var max = Math.max.apply(null, rows.map(function (x) { return x.n; }).concat([1]));
    return h('div', { class: 'bars' }, rows.map(function (x) {
      return h('div', { class: 'bar' + (x.wide ? ' wide' : '') }, h('b', { text: x.label }),
        h('div', { class: 'track' }, h('i', { style: 'width:' + Math.max(x.n ? 3 : 0, x.n / max * 100) + '%' + (x.color ? ';background:' + x.color : '') })),
        h('span', { class: 'num' }, nf(x.n), x.rate != null ? h('small', { text: ' · ' + x.rate }) : null));
    }));
  }

  function renderTryon() {
    var PERIODS = [['today', 'Hoje'], ['yesterday', 'Ontem'], ['7', '7 dias'], ['30', '30 dias'], ['90', '90 dias']];
    var days = h('select', { class: 'chip-btn', 'aria-label': 'Período' },
      PERIODS.map(function (p) { return h('option', { value: p[0], text: p[1], selected: p[0] === '30' }); }));
    function periodText() { var o = days.options[days.selectedIndex]; return o.value === 'today' || o.value === 'yesterday' ? o.text.toLowerCase() : 'últimos ' + o.text; }
    // com o que a janela atual é comparada (o servidor usa uma janela anterior do mesmo tamanho)
    function vsText() {
      var v = days.value;
      return v === 'today' ? 'vs. ontem' : v === 'yesterday' ? 'vs. anteontem' : 'vs. ' + v + ' dias anteriores';
    }
    // variação: "+20%" em verde, "−12%" em vermelho; sem base de comparação, só o período
    function deltaOf(now, before, fmt) {
      if (before == null) return { text: periodText() };
      now = Number(now) || 0; before = Number(before) || 0;
      if (now === before) return { text: 'Sem mudança ' + vsText() };
      if (before === 0) return { b: '+' + (fmt || nf)(now), text: ' ' + vsText(), up: true };
      var p = Math.round((now - before) / before * 100);
      if (p === 0) return { text: 'Sem mudança ' + vsText() };
      return { b: (p > 0 ? '+' : '−') + nf(Math.abs(p)) + '%', text: ' ' + vsText(), up: p > 0 };
    }
    var updated = h('p', { class: 'sub', text: 'Carregando…' });
    startFresh(updated);
    var box = h('div');
    // hoje e ontem: série por hora; demais períodos: por dia
    function lbl(row) { return row.hour != null ? String(row.hour).padStart(2, '0') + 'h' : row.day.slice(8, 10) + '/' + row.day.slice(5, 7); }
    // acima de 100% a etapa anterior não registrou tudo (ex.: aberturas contadas só a partir da versão nova): sem porcentagem
    function rate(a, b) { return b && a <= b ? pct(a / b) : null; }
    var seq = 0;
    function load() {
      var my = ++seq;
      if (fresh.at) updated.textContent = 'Atualizando…';
      api('GET', '/tryon?period=' + days.value).then(function (r) {
        // resposta velha (trocou o período de novo) ou a tela já é outra: ignora
        if (my !== seq || !document.body.contains(box)) return;
        var q = r.quota, s = r.stats, d = s.daily || [], pv = s.previous;
        state.me.tryon = q; paintStore();
        var col = function (k) { return d.map(function (x) { return x[k] || 0; }); };
        // receita comparada ao plano: só em janelas de 30 dias ou mais (o plano é mensal)
        var planMult = q.plan.price && s.revenue && s.days >= 30 ? s.revenue / (q.plan.price * s.days / 30) : null;
        box.innerHTML = '';
        add(box, [
          quotaBanner(q),
          kpiRow([
            { label: 'Provas', help: 'Provas prontas no período. Erros não contam.', value: nf(s.tryons), color: C.provas,
              note: q.plan.quota ? nf(q.used) + ' de ' + nf(q.plan.quota) + ' no mês' : null, series: col('tryons'), delta: deltaOf(s.tryons, pv && pv.tryons) },
            { label: 'Pessoas que provaram', help: 'Compradores diferentes que viram pelo menos uma prova.', value: nf(s.people), color: C.pessoas,
              note: s.people ? String(Math.round(s.tryons / s.people * 10) / 10).replace('.', ',') + ' provas por pessoa' : null, series: col('people'), delta: deltaOf(s.people, pv && pv.people) },
            { label: 'Vendas com o provador', help: 'Pedidos pagos com um produto que o comprador provou antes, em qualquer tamanho.', value: nf(s.sales), color: C.vendas,
              note: s.people ? pct(s.sales / s.people) + ' de quem provou comprou' : null, series: col('sales'), delta: deltaOf(s.sales, pv && pv.sales) },
            { label: 'Receita com o provador', help: 'Soma dos produtos provados nos pedidos pagos (preço x quantidade). Outros itens do pedido não entram.', cur: 'R$', value: nf(Math.round(s.revenue || 0)), color: C.receita,
              note: planMult ? String(Math.round(planMult * 10) / 10).replace('.', ',') + '× o valor do plano' : null, series: col('revenue'), delta: deltaOf(s.revenue, pv && pv.revenue, brl) },
          ]),
          h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', { text: 'Quem provou e quem comprou' })),
            s.tryons ? lineChart(d, [
              { key: 'people', label: 'Pessoas que provaram', color: C.provas },
              { key: 'sales', label: 'Vendas', color: C.vendas },
            ], lbl) : h('p', { class: 'chart-empty', text: 'As provas aparecem aqui assim que os compradores começarem a usar.' })),
          h('div', { class: 'grid cols-2' },
            // rosa do claro ao escuro a cada etapa; verde só onde entra dinheiro (Compraram)
            h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', { text: 'Do botão à compra' })),
              barList([
                { label: 'Viram o botão', n: s.views, wide: true, color: 'var(--pink-3)' },
                { label: 'Abriram', n: s.opened, rate: rate(s.opened, s.views), wide: true, color: 'var(--pink-2)' },
                { label: 'Provaram', n: s.triedVisits, rate: rate(s.triedVisits, s.opened), wide: true, color: 'var(--pink-15)' },
                { label: 'Clicaram em Comprar', n: s.buys, rate: rate(s.buys, s.triedVisits), wide: true, color: 'var(--pink)' },
                { label: 'Compraram', n: s.sales, rate: rate(s.sales, s.triedVisits), wide: true, color: 'var(--green)' },
              ]),
              h('p', { class: 'note', text: 'Cada etapa conta visitas à loja. A porcentagem compara com a etapa anterior, e em Compraram compara com quem provou.' })),
            h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', { text: 'Compartilhamentos' })),
              barList([
                { label: 'Links criados', n: s.shares, wide: true, color: 'var(--pink-3)' },
                { label: 'Abriram o link', n: s.shareViews, wide: true, color: 'var(--pink-2)' },
                { label: 'Foram à loja', n: s.shareClicks, rate: rate(s.shareClicks, s.shareViews), wide: true, color: 'var(--pink)' },
              ]),
              h('p', { class: 'note', text: 'Quem abre o link compartilhado vê a prova e pode provar também ou ir direto ao produto.' }))),
          h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', { text: 'Produtos mais provados' })),
            // no celular: nome e, logo abaixo, "95 provas · 13 vendas · 14% compraram" (data-short)
            s.top && s.top.length ? h('table', { class: 't top-t' },
              h('thead', null, h('tr', null, h('th', { text: 'Produto' }), h('th', { class: 'num', text: 'Provas' }), h('th', { class: 'num', text: 'Vendas' }), h('th', { class: 'num', text: '% que comprou' }))),
              h('tbody', null, s.top.map(function (p) {
                return h('tr', null, h('td', { text: p.name || ('#' + p.id) }),
                  h('td', { class: 'num', text: nf(p.tryons), 'data-short': Number(p.tryons) === 1 ? 'prova' : 'provas' }),
                  h('td', { class: 'num', text: nf(p.sales), 'data-short': Number(p.sales) === 1 ? 'venda' : 'vendas' }),
                  h('td', { class: 'num conv', text: p.tryons ? pct(p.sales / p.tryons) : '0%', 'data-short': 'compraram' }));
              }))) : h('p', { class: 'chart-empty', text: 'Ainda sem provas no período.' }),
            s.avgSeconds ? h('p', { class: 'note' }, icon('timer'), 'Tempo médio de uma prova: ' + String(s.avgSeconds).replace('.', ',') + ' s') : null),
        ]);
        markFresh();
      }).catch(function (e) {
        if (my !== seq) return;
        // não diz que está atualizado se não está: volta à idade real dos números (ou avisa)
        if (fresh.at) paintFresh(); else updated.textContent = 'Não deu para carregar agora.';
        fail(e);
      });
    }
    days.addEventListener('change', load);
    add(view, [pageHead('Visão geral', updated, [days]), box]);
    load();
  }

  // ---------- leads ----------
  function renderLeads() {
    api('GET', '/tryon/leads?limit=500').then(function (r) {
      var leads = r.leads, on = !!(state.me.settings.tryon || {}).leadCapture;
      add(view, [
        pageHead('Leads', 'Converse com quem já provou.',
          leads.length ? [chipBtn('Baixar planilha', 'download', downloadLeads)] : null),
        on ? null : h('div', { class: 'banner' }, icon('whatsapp'), h('div', { class: 'banner-t' }, h('b', { text: 'A captura de WhatsApp está desligada' }),
          h('span', { text: 'Ligue em Preferências: o comprador faz a primeira prova e informa o WhatsApp para continuar.' })),
          h('button', { class: 'btn sm primary', type: 'button', onclick: function () { go('prefs'); } }, 'Abrir Preferências', icon('arrow-right'))),
        h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', { text: leads.length ? pl(leads.length, 'contato', 'contatos') : 'Contatos' })),
          leads.length ? h('table', { class: 't' },
            h('thead', null, h('tr', null, h('th', { text: 'WhatsApp' }), h('th', { text: 'Provou' }), h('th', { class: 'num', text: 'Provas' }), h('th', { class: 'hide-sm', text: 'Quando' }), h('th', { class: 'act' }))),
            h('tbody', null, leads.map(function (l) {
              var wa = 'https://wa.me/' + l.phone.replace(/\D/g, '');
              return h('tr', null,
                h('td', { text: fmtPhone(l.phone) }), h('td', { text: l.product_name || 'Sem produto' }), h('td', { class: 'num', text: nf(l.tryons) }),
                h('td', { class: 'hide-sm', text: fmtDate(l.created_at) }),
                h('td', { class: 'act' }, h('a', { class: 'chip-btn', href: wa, target: '_blank', rel: 'noopener' }, icon('whatsapp'), 'Conversar')));
            }))) : h('p', { class: 'chart-empty', text: on ? 'Os números aparecem aqui quando os compradores fizerem a segunda prova.' : 'Nenhum contato ainda.' })),
        h('p', { class: 'note', text: 'O comprador informou o WhatsApp para continuar provando.' }),
      ]);
    }).catch(fail);
  }

  // ---------- preferências ----------
  function renderPrefs() {
    var t = state.me.settings.tryon || {};
    var f = { enabled: t.enabled !== false, leadCapture: !!t.leadCapture, freeBeforeLead: t.freeBeforeLead == null ? 1 : t.freeBeforeLead, dailyPerShopper: t.dailyPerShopper || 10, buttonIcon: t.buttonIcon !== false, hideOutOfStock: t.hideOutOfStock !== false, showBrand: t.showBrand !== false, button: t.button || 'Provar em mim' };
    function sw(key, label, hint, locked) {
      var input = h('input', { type: 'checkbox', checked: f[key], disabled: !!locked, onchange: function (e) { f[key] = e.target.checked; } });
      return h('div', { class: 'pref' }, h('div', null, h('b', { text: label }), hint ? h('span', { class: 'muted', text: hint }) : null),
        h('label', { class: 'switch' }, input, h('span')));
    }
    var freeSel = h('select', { class: 'chip-btn', 'aria-label': 'Provas antes de pedir o WhatsApp', onchange: function (e) { f.freeBeforeLead = Number(e.target.value); } },
      [0, 1, 2, 3].map(function (n) { return h('option', { value: n, text: n === 0 ? 'Já na 1ª prova' : 'Depois de ' + pl(n, 'prova', 'provas'), selected: f.freeBeforeLead === n }); }));
    var dailyOpts = [3, 5, 10, 15, 20, 30, 50];
    if (dailyOpts.indexOf(f.dailyPerShopper) < 0) dailyOpts.push(f.dailyPerShopper);
    var dailySel = h('select', { class: 'chip-btn', 'aria-label': 'Provas por comprador por dia', onchange: function (e) { f.dailyPerShopper = Number(e.target.value); } },
      dailyOpts.sort(function (a, b) { return a - b; }).map(function (n) { return h('option', { value: n, text: pl(n, 'prova', 'provas'), selected: f.dailyPerShopper === n }); }));
    var btnText = h('input', { type: 'text', value: f.button, maxlength: '40', oninput: function (e) { f.button = e.target.value; } });
    add(view, [
      pageHead('Preferências', 'Personalize o provador da sua loja.'),
      h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', { text: 'Na loja' })),
        sw('enabled', 'Provador na loja', 'Mostra o botão nas páginas de produto com foto.'),
        sw('buttonIcon', 'Ícone no botão', 'Mostra o ícone antes do texto. Desligado, o botão fica só com o texto.'),
        sw('hideOutOfStock', 'Esconder em produtos sem estoque', 'O botão não aparece quando todas as opções do produto estão esgotadas. Assim nenhuma prova da cota vai para um produto que não dá para comprar.'),
        state.me.brandRemovable
          ? sw('showBrand', 'Marca Miaou no provador', 'Mostra "Provador virtual por Miaou" no rodapé do provador e do link compartilhado.')
          : sw('showBrand', 'Marca Miaou no provador', 'Para remover a marca, suba para o plano Escalar.', true),
        h('label', { class: 'f', style: 'margin:14px 0 0' }, 'Texto do botão', btnText)),
      lookCard(f),
      h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', { text: 'WhatsApp' })),
        sw('leadCapture', 'Pedir o WhatsApp', 'O comprador faz as primeiras provas livre; para continuar, informa o WhatsApp. Os números ficam em Leads.'),
        h('div', { class: 'pref' }, h('div', null, h('b', { text: 'Quando pedir' }), h('span', { class: 'muted', text: 'Quantas provas o comprador faz antes.' })), freeSel)),
      h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', { text: 'Proteção do plano' })),
        h('div', { class: 'pref' }, h('div', null, h('b', { text: 'Provas por comprador por dia' }),
          h('span', { class: 'muted', text: 'Evita que uma pessoa sozinha gaste as provas do mês. Provas repetidas (mesma foto e mesmo produto) não contam.' })), dailySel)),
      installCard(),
      supportCard(),
      h('div', { class: 'row', style: 'justify-content:flex-end' }, h('button', { class: 'btn primary', text: 'Salvar', onclick: function () {
        api('PUT', '/settings', { tryon: { enabled: f.enabled, leadCapture: f.leadCapture, freeBeforeLead: f.freeBeforeLead, dailyPerShopper: f.dailyPerShopper, buttonIcon: f.buttonIcon, hideOutOfStock: f.hideOutOfStock, showBrand: f.showBrand, button: f.button.trim(), look: f.look } })
          .then(function () { toast('Preferências salvas'); return loadMe(); }).then(function () { go('prefs'); }).catch(fail);
      } })),
    ]);
  }

  // Aparência do provador: Estilo Miaou ou Estilo da loja. O Miaou lê sozinho
  // as cores do botão, os cantos e a fonte do tema (e relê a cada 12 h); o
  // lojista só ajusta o que quiser. A prévia é o provador de verdade num
  // celular, com um produto da própria loja. Recurso do plano Crescer para cima.
  var PILL = 30;
  function lookCard(f) {
    var me = state.me;
    var L = me.look || { allowed: false, mode: 'miaou' };
    // f.look guarda só os ajustes (null = seguir a loja) e o modo
    f.look = { mode: L.mode === 'loja' && L.allowed ? 'loja' : 'miaou',
      buttonBg: L.adjusted && L.adjusted.buttonBg ? L.buttonBg : null, buttonFg: L.adjusted && L.adjusted.buttonFg ? L.buttonFg : null,
      buttonRadius: L.adjusted && L.adjusted.buttonRadius ? L.buttonRadius : null, cardRadius: L.adjusted && L.adjusted.cardRadius ? L.cardRadius : null,
      useStoreFont: L.useStoreFont !== false };
    var eff = L;                    // valores efetivos (vêm do servidor a cada ajuste)
    var lastStyle = null;
    var screen = 'start';
    var product = null;
    var body = h('div', { class: 'look-ctl' });

    // ---- prévia: o provador real num celular ----
    var frame = h('iframe', { class: 'phone-screen', title: 'Prévia do provador', tabindex: '-1',
      src: '/tryon/?store=' + encodeURIComponent(me.store.id) + '&preview=1&layout=overlay' });
    // atrás do provador, a página do produto (como na loja: o card sobe por cima dela)
    var storeImg = h('div', { class: 'ps-img' });
    var storeName = h('b', { class: 'ps-name', text: 'Produto da sua loja' });
    var storePrice = h('span', { class: 'ps-price' });
    var storePage = h('div', { class: 'phone-store', 'aria-hidden': 'true' },
      h('div', { class: 'ps-bar' }, h('i'), h('span', { text: (me.store.name || 'Sua loja').toUpperCase() }), h('i')),
      storeImg, h('div', { class: 'ps-info' }, storeName, storePrice, h('span', { class: 'ps-buy', text: 'Comprar' })));
    var ready = false;
    function sendPreview() {
      if (!ready) return;
      frame.contentWindow.postMessage({ source: 'miaou-admin', type: 'look', style: f.look.mode === 'loja' ? lastStyle : null, screen: screen, product: product }, location.origin);
    }
    // uma escuta só, mesmo voltando a Preferências várias vezes
    if (window.__lookMsg) window.removeEventListener('message', window.__lookMsg);
    window.__lookMsg = function (e) {
      if (e.origin === location.origin && e.data && e.data.source === 'mq-preview' && e.data.type === 'ready' && e.source === frame.contentWindow) { ready = true; sendPreview(); }
    };
    window.addEventListener('message', window.__lookMsg);
    api('GET', '/products?limit=30').then(function (r) {
      var p = (r.items || []).find(function (x) { return x.image; });
      if (p) {
        product = { name: p.name, price: p.price, image: p.image };
        storeImg.style.backgroundImage = 'url("' + String(p.image).replace(/["\\]/g, '') + '")';
        storeName.textContent = p.name;
        storePrice.textContent = p.price ? 'R$ ' + Number(p.price).toFixed(2).replace('.', ',') : '';
        sendPreview();
      }
    }).catch(function () {});
    var tabs = h('div', { class: 'seg seg-sm', role: 'group', 'aria-label': 'Tela da prévia' },
      [['start', 'Início'], ['generating', 'Gerando'], ['result', 'Resultado']].map(function (o) {
        return h('button', { type: 'button', 'aria-pressed': String(o[0] === screen), text: o[1], onclick: function (e) {
          screen = o[0];
          Array.prototype.forEach.call(tabs.children, function (b) { b.setAttribute('aria-pressed', String(b === e.currentTarget)); });
          sendPreview();
        } });
      }));
    // celular: barra de status (hora, sinal, Wi-Fi, bateria), recorte no topo,
    // o provador como app aberto e a barra de início embaixo
    var clock = h('span', { class: 'sb-time', text: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) });
    var sbIcons = h('span', { class: 'sb-icons' });
    sbIcons.innerHTML =
      '<svg viewBox="0 0 18 12" aria-hidden="true"><rect x="0" y="8" width="3" height="4" rx="1"/><rect x="5" y="5.5" width="3" height="6.5" rx="1"/><rect x="10" y="3" width="3" height="9" rx="1"/><rect x="15" y="0" width="3" height="12" rx="1"/></svg>' +
      '<svg viewBox="0 0 16 12" aria-hidden="true"><path d="M8 2.2c2.4 0 4.6.9 6.2 2.5l1.3-1.4C13.5 1.3 10.9.2 8 .2S2.5 1.3.5 3.3l1.3 1.4C3.4 3.1 5.6 2.2 8 2.2z"/><path d="M8 5.6c1.5 0 2.8.6 3.8 1.5l1.3-1.4C11.8 4.4 10 3.6 8 3.6S4.2 4.4 2.9 5.7l1.3 1.4c1-.9 2.3-1.5 3.8-1.5z"/><path d="M8 9c.7 0 1.3.3 1.7.7L8 11.6 6.3 9.7C6.7 9.3 7.3 9 8 9z"/></svg>' +
      '<svg class="bat" viewBox="0 0 27 13" aria-hidden="true"><rect x=".5" y=".5" width="23" height="12" rx="3.5" fill="none" stroke-opacity=".35"/><rect x="2" y="2" width="17" height="9" rx="2"/><path d="M25 4.5v4c.8-.3 1.5-1.1 1.5-2s-.7-1.7-1.5-2z" fill-opacity=".4"/></svg>';
    var phone = h('div', { class: 'phone' },
      h('i', { class: 'phone-btn vol-up' }), h('i', { class: 'phone-btn vol-down' }), h('i', { class: 'phone-btn power' }),
      h('div', { class: 'phone-glass' },
        h('div', { class: 'phone-status' }, clock, h('span', { class: 'phone-notch' }), sbIcons),
        h('div', { class: 'phone-app' }, storePage, frame),
        h('div', { class: 'phone-home' }, h('span'))));

    var timer;
    function refresh() {
      if (f.look.mode !== 'loja') { lastStyle = null; sendPreview(); return; }
      clearTimeout(timer);
      timer = setTimeout(function () {
        api('POST', '/tryon/look/preview', { look: { buttonBg: f.look.buttonBg, buttonFg: f.look.buttonFg, buttonRadius: f.look.buttonRadius, cardRadius: f.look.cardRadius, useStoreFont: f.look.useStoreFont } })
          .then(function (r) { lastStyle = r.style; eff = Object.assign({}, eff, r.look); sendPreview(); paintValues(); })
          .catch(fail);
      }, 120);
    }
    // ler o tema (automático: ao ligar o Estilo da loja pela primeira vez)
    function readStore() {
      body.classList.add('busy');
      return api('POST', '/tryon/look/refresh').then(function (r) { eff = Object.assign({ allowed: true }, r.look); })
        .catch(function (e) { toast(e.message, true); })
        .then(function () { body.classList.remove('busy'); render(); });
    }

    var refs = {};
    function source(key) {
      if (!f.look[key] && f.look[key] !== 0) return h('span', { class: 'src', text: 'da loja' });
      return h('button', { type: 'button', class: 'src link', text: 'usar o da loja', onclick: function () { f.look[key] = null; refresh(); render(); } });
    }
    function pxLabel(key, v) {
      if (key === 'buttonRadius' && v >= PILL) return 'Pílula';
      return v === 0 ? '0' : v + ' px';
    }
    function paintValues() {
      ['buttonBg', 'buttonFg'].forEach(function (k) { if (refs[k]) { refs[k].input.value = eff[k]; refs[k].hex.textContent = eff[k]; } });
      ['buttonRadius', 'cardRadius'].forEach(function (k) { if (refs[k]) { refs[k].input.value = eff[k]; refs[k].input.style.setProperty('--fill', (eff[k] / refs[k].max * 100) + '%'); refs[k].out.textContent = pxLabel(k, eff[k]); } });
    }
    function colorRow(key, label, hint) {
      var hex = h('span', { class: 'hex', text: eff[key] });
      var input = h('input', { type: 'color', value: eff[key], 'aria-label': label, oninput: function (e) {
        f.look[key] = e.target.value; eff[key] = e.target.value; hex.textContent = e.target.value; refresh();
      }, onchange: function () { render(); } });
      refs[key] = { input: input, hex: hex };
      return h('div', { class: 'pref' }, h('div', null, h('b', null, label, ' ', source(key)), hint ? h('span', { class: 'muted', text: hint }) : null),
        h('label', { class: 'swatch' }, input, hex));
    }
    function rangeRow(key, label, hint, max) {
      var out = h('output', { class: 'px', text: pxLabel(key, eff[key]) });
      var input = h('input', { type: 'range', min: '0', max: String(max), step: '1', value: String(eff[key]), 'aria-label': label,
        style: '--fill:' + (eff[key] / max * 100) + '%',
        oninput: function (e) {
          var v = Number(e.target.value);
          f.look[key] = v; eff[key] = v; out.textContent = pxLabel(key, v);
          e.target.style.setProperty('--fill', (v / max * 100) + '%'); refresh();
        }, onchange: function () { render(); } });
      refs[key] = { input: input, out: out, max: max };
      return h('div', { class: 'pref pref-range' }, h('div', null, h('b', null, label, ' ', source(key)), hint ? h('span', { class: 'muted', text: hint }) : null),
        h('div', { class: 'range' }, input, out));
    }
    function render() {
      body.innerHTML = '';
      refs = {};
      var locked = !L.allowed;
      var seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Aparência do provador' },
        [['miaou', 'Estilo Miaou'], ['loja', 'Estilo da loja']].map(function (o) {
          return h('button', { type: 'button', disabled: locked && o[0] === 'loja', 'aria-pressed': String(f.look.mode === o[0]), text: o[1], onclick: function () {
            if (f.look.mode === o[0]) return;
            f.look.mode = o[0];
            if (o[0] === 'loja' && !eff.detectedAt) { render(); readStore(); return; }
            render();
          } });
        }));
      add(body, h('div', { class: 'look-mode' }, seg));
      if (locked) {
        add(body, h('div', { class: 'look-lock' },
          h('p', { class: 'muted', text: 'O Estilo da loja deixa o provador com as cores, os cantos e a fonte do seu tema. Faz parte dos planos a partir do Crescer.' }),
          h('button', { class: 'chip-btn', type: 'button', text: 'Ver planos', onclick: function () { go('plan'); } })));
      } else if (f.look.mode === 'miaou') {
        add(body, h('p', { class: 'muted look-note', text: 'O provador usa o visual do Miaou.' }));
      } else if (!eff.detectedAt) {
        add(body, h('p', { class: 'muted look-note', text: 'Lendo as cores e a fonte do tema da sua loja…' }));
      } else {
        add(body, [
          colorRow('buttonBg', 'Cor do botão principal'),
          colorRow('buttonFg', 'Texto do botão'),
          rangeRow('buttonRadius', 'Border-radius dos botões', null, PILL),
          rangeRow('cardRadius', 'Border-radius das fotos e cartões', null, 28),
          h('div', { class: 'pref' }, h('div', null, h('b', { text: 'Fonte da loja' }),
            h('span', { class: 'muted', text: eff.font ? eff.font + (eff.fontHeading && eff.fontHeading !== eff.font ? ', títulos em ' + eff.fontHeading : '') : 'Não encontramos a fonte do tema; o provador usa a fonte do Miaou.' })),
            h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: f.look.useStoreFont && !!eff.font, disabled: !eff.font, onchange: function (e) { f.look.useStoreFont = e.target.checked; refresh(); } }), h('span'))),
        ]);
      }
      refresh();
    }
    render();
    // o celular se encolhe por inteiro (como uma imagem) quando falta espaço: telas de 320 px
    var PHONE_W = 318;   // largura do celular com bordas e botões laterais
    var fit = h('div', { class: 'phone-fit' }, phone);
    var prev = h('div', { class: 'look-prev' }, fit, tabs);
    function scalePhone() {
      var w = prev.clientWidth;
      if (!w) return;
      var k = Math.min(1, w / PHONE_W);
      // zoom (e não transform): a janela do provador dentro do celular encolhe junto
      phone.style.zoom = k < 1 ? String(Math.floor(k * 1000) / 1000) : '';
    }
    if ('ResizeObserver' in window) new ResizeObserver(scalePhone).observe(prev);
    else window.addEventListener('resize', scalePhone);
    requestAnimationFrame(scalePhone);
    return h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', { text: 'Aparência do provador' }),
      !L.allowed ? h('span', { class: 'chip', text: 'Crescer ou maior' }) : null),
      h('div', { class: 'look-grid' }, body, prev));
  }

  // Suporte: e-mail da Miaou, com botão para copiar.
  function supportCard() {
    var mail = state.me.supportEmail || 'suporte@miaou.com.br';
    function copy() {
      var done = function () { toast('E-mail copiado'); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(mail).then(done, function () { location.href = 'mailto:' + mail; });
      else location.href = 'mailto:' + mail;
    }
    return h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', { text: 'Suporte' })),
      h('div', { class: 'pref' },
        h('div', null, h('b', null, h('a', { href: 'mailto:' + mail, class: 'mail', text: mail })),
          h('span', { class: 'muted', text: 'Dúvidas, instalação ou algo que não funcionou: escreva para a gente.' })),
        h('button', { class: 'chip-btn', type: 'button', onclick: copy }, 'Copiar e-mail')));
  }

  // Onde o botão está instalado: script automático (Portal de Parceiros) ou linha manual no tema.
  function installCard() {
    var me = state.me;
    return h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', { text: 'Instalação na loja' }),
      h('span', { class: 'chip' + (me.scriptInstalled ? ' ok' : ' warn'), text: me.scriptInstalled ? 'Instalado' : 'Não instalado' })),
      me.scriptInstalled ? h('p', { class: 'muted', style: 'margin:0', text: 'O botão aparece sozinho nas páginas de produto, e as vendas feitas depois de uma prova entram no painel.' })
        : h('div', null,
          me.scriptConfigured ? h('p', null, h('button', { class: 'btn sm primary', type: 'button', text: 'Instalar na loja', onclick: installScript })) : null,
          h('p', { class: 'muted', text: 'Ou cole esta linha no código do tema (Minha Nuvemshop › Layout › Editar código, antes de </body>):' }),
          h('p', { style: 'margin:0' }, h('code', { text: '<script src="' + me.loaderUrl + '" async></script>' }))));
  }

  // ---------- planos ----------
  // Cartões no formato da referência: nome, preço ("R$" pequeno, valor grande,
  // "/mês" em cinza), provas por mês com a economia em verde, todos os
  // recursos do plano e o botão largo. Acima do
  // maior plano, o Volume: o cartão escuro com o degradê do Miaou e uma barra
  // com degraus fixos, cada um com preço por prova menor.
  // desconto por prova em relação ao plano de entrada (só quando existe)
  function saving(p, base) {
    var pct = Math.round((1 - (p.price / p.quota) / (base.price / base.quota)) * 100);
    return pct >= 5 ? pct : 0;
  }
  function planName(plan) { return plan.key.indexOf('volume-') === 0 ? 'Volume ' + nf(plan.quota) : plan.name; }
  function renderPlan() {
    api('GET', '/tryon?days=30').then(function (r) {
      var q = r.quota;
      state.me.tryon = q; paintStore();
      var usedPct = q.plan.quota ? Math.min(1, q.used / q.plan.quota) : 0;
      var contact = 'mailto:' + (state.me.supportEmail || 'suporte@miaou.com.br') + '?subject=' + encodeURIComponent('Plano do provador · loja ' + state.me.store.id);
      var ladder = r.plans.concat(r.volume || []);
      var curIdx = ladder.findIndex(function (p) { return p.key === q.plan.key; });
      function choose(p) {
        if (!r.allowSelfPlan) { location.href = contact; return; }
        api('PUT', '/tryon/plan', { plan: p.key }).then(function () { toast('Plano ' + planLabel(p) + ' ativado'); return loadMe(); }).then(function () { go('plan'); }).catch(fail);
      }
      function planLabel(p) { return p.volume ? 'Volume ' + nf(p.quota) : p.name; }
      function actionText(p) {
        if (!r.allowSelfPlan) return 'Falar com a Miaou';
        if (curIdx < 0) return 'Escolher plano';
        return ladder.indexOf(p) > curIdx ? 'Subir de plano' : 'Mudar de plano';
      }
      var base = r.plans[0];
      function price(v) {
        return h('div', { class: 'price' }, h('span', { class: 'cur', text: 'R$' }), h('span', { class: 'big', text: nf(v) }), h('span', { class: 'per', text: '/mês' }));
      }
      function billed(p) {
        var pct = saving(p, base);
        return h('div', { class: 'billed' }, nf(p.quota) + ' provas por mês', pct ? [' ', h('span', { class: 'save', text: '(prova ' + pct + '% mais barata)' })] : null);
      }
      function planButton(p, dark) {
        var cur = p.key === q.plan.key;
        return h('button', { class: 'btn ' + (dark ? 'light' : 'primary'), type: 'button', disabled: cur, onclick: function () { choose(p); } },
          cur ? 'Seu plano atual' : actionText(p));
      }
      // todos os recursos do plano, com o check do Hugeicons
      function feats(list) {
        return h('ul', { class: 'feats' }, (list || []).map(function (x) { return h('li', null, icon('check'), h('span', { text: x })); }));
      }
      var cards = r.plans.map(function (p) {
        return h('article', { class: 'plan' },
          h('div', { class: 'plan-top' },
            h('h3', { text: p.name }),
            h('div', { class: 'price-box' }, price(p.price), billed(p)),
            feats(p.features)),
          planButton(p, false));
      });

      // Volume: cartão escuro com a barra dos degraus acima do maior plano
      var vol = r.volume || [];
      var volCard = null;
      if (vol.length) {
        var at = Math.max(0, vol.findIndex(function (p) { return p.key === q.plan.key; }));
        var priceSlot = h('div'), billedSlot = h('div'), btnSlot = h('div');
        var range = h('input', { type: 'range', min: '0', max: String(vol.length - 1), step: '1', value: String(at), class: 'vol-range', 'aria-label': 'Provas por mês no plano Volume' });
        var ticks = h('div', { class: 'vol-ticks' }, vol.map(function (p, i) {
          return h('button', { type: 'button', text: nf(p.quota), onclick: function () { range.value = String(i); paint(); } });
        }));
        var paint = function () {
          var i = Number(range.value);
          var p = vol[i];
          range.style.setProperty('--fill', (vol.length > 1 ? i / (vol.length - 1) * 100 : 100) + '%');
          priceSlot.innerHTML = ''; priceSlot.appendChild(price(p.price));
          billedSlot.innerHTML = ''; billedSlot.appendChild(billed(p));
          range.setAttribute('aria-valuetext', nf(p.quota) + ' provas por ' + brl(p.price) + ' ao mês');
          Array.prototype.forEach.call(ticks.children, function (b, k) { b.className = k === i ? 'on' : ''; });
          btnSlot.innerHTML = ''; btnSlot.appendChild(planButton(p, true));
        };
        range.addEventListener('input', paint);
        volCard = h('div', { class: 'glow' }, h('article', { class: 'plan night' },
          h('div', { class: 'plan-top' },
            h('h3', { text: 'Volume' }),
            h('p', { class: 'plan-desc', text: 'Acima de ' + nf(r.plans[r.plans.length - 1].quota) + ' provas. Escolha exatamente quantas sua loja precisa.' }),
            h('div', { class: 'price-box' }, priceSlot, billedSlot),
            h('div', null, range, ticks),
            feats(vol[0].features)),
          btnSlot));
        paint();
      }

      var meter = h('div', { class: 'meter' + (q.exhausted ? ' bad' : q.alert ? ' warn' : ''), role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100',
        'aria-valuenow': String(Math.round(usedPct * 100)), 'aria-label': 'Provas usadas no mês' },
        h('i', { style: 'width:' + (q.used ? Math.max(2, Math.round(usedPct * 100)) : 0) + '%' }));
      add(view, [
        pageHead('Planos', 'Preços em reais, cobrança mensal.'),
        q.plan.key !== 'none' ? h('div', { class: 'card' },
          h('div', { class: 'card-head', style: 'margin-bottom:12px' }, h('h2', { text: 'Uso deste mês' }),
            q.exhausted ? h('span', { class: 'chip bad', text: 'Esgotado' }) : h('span', { class: 'chip ok', text: 'Ativo' })),
          h('div', { class: 'usage' + (q.exhausted ? ' bad' : '') }, h('b', { text: nf(q.used) }), h('span', { text: 'de ' + nf(q.plan.quota) + ' provas' })),
          meter,
          h('p', { class: 'usage-cap', text: 'Renova em ' + renewText(q) + '. Quando as provas acabam, o botão sai da loja até renovar.' })) : quotaBanner(q),
        h('div', { class: 'plans' }, cards, volCard),
      ]);
    }).catch(fail);
  }

  function syncProducts(e) {
    var b = e.currentTarget; b.disabled = true; b.textContent = 'Sincronizando…';
    api('POST', '/products/sync').then(function (r) { toast(r.count + ' produtos sincronizados'); return loadMe(); })
      .then(function () { go(currentTab() || 'tryon'); }).catch(function (err) { fail(err); b.disabled = false; b.textContent = 'Sincronizar agora'; });
  }
  function installScript() {
    api('POST', '/script/install').then(function () { toast('Script instalado'); return loadMe(); })
      .then(function () { go(currentTab() || 'tryon'); }).catch(fail);
  }

  // ---------- produtos ----------
  var KIND = { garment: 'Roupa', glasses: 'Óculos' };
  function renderProducts() {
    var PER_PAGE = 20;
    var page = 1;
    var search = h('input', { type: 'search', placeholder: 'Nome ou nº do produto', 'aria-label': 'Buscar produto por nome ou número' });
    var box = h('div', { class: 'card' });
    var pager = h('div', { class: 'pager' });
    function renderPager(total) {
      pager.innerHTML = '';
      var pages = Math.max(1, Math.ceil(total / PER_PAGE));
      if (total <= PER_PAGE) return;   // uma página só: sem rodapé
      var first = (page - 1) * PER_PAGE + 1;
      var last = Math.min(page * PER_PAGE, total);
      add(pager, [
        h('button', { class: 'chip-btn', type: 'button', disabled: page <= 1, 'aria-label': 'Página anterior',
          onclick: function () { if (page > 1) { page--; load(); } } }, icon('chevron-left'), 'Anterior'),
        h('span', { class: 'pager-info', text: nf(first) + ' a ' + nf(last) + ' de ' + pl(total, 'produto', 'produtos') }),
        h('button', { class: 'chip-btn', type: 'button', disabled: page >= pages, 'aria-label': 'Próxima página',
          onclick: function () { if (page < pages) { page++; load(); } } }, 'Próxima', icon('chevron-right')),
      ]);
    }
    function load() {
      var q = '/products?limit=' + PER_PAGE + '&offset=' + ((page - 1) * PER_PAGE) + '&search=' + encodeURIComponent(search.value.trim());
      api('GET', q).then(function (r) {
        if (!r.items.length && r.total && page > 1) { page = Math.ceil(r.total / PER_PAGE); load(); return; }
        box.innerHTML = '';
        renderPager(r.total);
        if (!r.items.length) { add(box, h('p', { class: 'empty', text: 'Nenhum produto encontrado.' })); return; }
        add(box, h('table', { class: 't' },
          h('thead', null, h('tr', null, h('th', { class: 'hide-sm' }), h('th', { text: 'Produto' }), h('th', { text: 'Provador virtual' }))),
          h('tbody', null, r.items.map(function (p) {
            // automático: reconhece óculos pelo nome; dá para forçar ou desligar
            var kindSel = h('select', { 'aria-label': 'Provador virtual de ' + p.name },
              [['', 'Automático (' + (KIND[p.tryon_auto] || 'desligado') + ')'], ['garment', 'Roupa'], ['glasses', 'Óculos'], ['off', 'Desligado']].map(function (o) {
                return h('option', { value: o[0], text: o[1], selected: (p.tryon_kind || '') === o[0] });
              }));
            kindSel.addEventListener('change', function () {
              api('PUT', '/products/' + p.id + '/tryon', { kind: kindSel.value || null })
                .then(function () { toast('Produto atualizado'); }).catch(fail);
            });
            var noImg = !p.image ? h('div', null, h('span', { class: 'chip warn', text: 'sem foto: o botão não aparece' })) : null;
            return h('tr', null,
              h('td', { class: 'hide-sm' }, p.image ? h('img', { class: 'thumb', src: p.image, alt: '' }) : h('span', { class: 'thumb', style: 'display:inline-block' })),
              h('td', null, h('b', { text: p.name }), h('div', { class: 'muted', text: p.categories.map(function (c) { return c.name; }).join(', ') })),
              h('td', null, kindSel, noImg));
          }))));
        box.appendChild(pager);   // rodapé do cartão, abaixo da tabela
      }).catch(fail);
    }
    var t;
    search.addEventListener('input', function () { clearTimeout(t); t = setTimeout(function () { page = 1; load(); }, 250); });
    load();
    add(view, [
      pageHead('Produtos', 'Escolha em quais produtos o botão aparece.',
        [chipBtn('Sincronizar catálogo', 'refresh', syncProducts)]),
      h('div', { class: 'row filters', style: 'margin-bottom:12px' }, search),
      box,
    ]);
  }

  // ---------- início ----------
  // cartão da loja no menu: status, interruptor e uso do mês
  var enabled = document.getElementById('enabled');
  function paintEnabled(on) {
    var lab = document.getElementById('enabledLabel');
    lab.textContent = on ? 'Ativo na loja' : 'Desativado';
    lab.classList.toggle('off', !on);
  }
  function paintStore() {
    var q = state.me && state.me.tryon;
    var box = document.getElementById('storeQuota');
    var btn = document.getElementById('storePlanBtn');
    if (!q || !q.plan || q.plan.key === 'none' || !q.plan.quota) {
      box.hidden = true;
      btn.textContent = 'Escolher plano';
      return;
    }
    var p = Math.min(100, Math.round(q.used / q.plan.quota * 100));
    var meter = document.getElementById('storeMeter');
    document.getElementById('storePlan').textContent = 'Plano ' + planName(q.plan);
    document.getElementById('storeUsed').textContent = nf(q.used);
    document.getElementById('storeOf').textContent = 'de ' + nf(q.plan.quota) + ' provas';
    meter.className = 'meter' + (q.exhausted ? ' bad' : q.alert ? ' warn' : '');
    meter.setAttribute('aria-valuenow', String(p));
    meter.firstElementChild.style.width = (q.used ? Math.max(2, p) : 0) + '%';
    document.getElementById('storePct').textContent = q.exhausted ? 'Provas esgotadas' : p + '% usado';
    var rd = renewDate(q);
    document.getElementById('storeRenew').textContent = 'Renova ' + String(rd.getDate()).padStart(2, '0') + '/' + String(rd.getMonth() + 1).padStart(2, '0');
    box.hidden = false;
    btn.textContent = 'Ver planos';
  }
  document.getElementById('storePlanBtn').addEventListener('click', function () { go('plan'); });
  enabled.addEventListener('change', function () {
    var on = enabled.checked;
    paintEnabled(on);
    api('PUT', '/settings', { enabled: on }).then(function (r) {
      state.me.settings = r.settings;
      toast(on ? 'Provador ativado na loja' : 'Provador desativado');
    }).catch(function (e) {
      // não salvou: o interruptor volta para o estado de verdade
      enabled.checked = !on;
      paintEnabled(!on);
      fail(e);
    });
  });

  function loadMe() {
    return api('GET', '/me').then(function (me) {
      state.me = me;
      var sn = document.getElementById('storeName');
      if (sn) sn.textContent = me.store.name || ('Loja #' + me.store.id);
      enabled.checked = me.settings.enabled;
      paintEnabled(me.settings.enabled);
      paintStore();
    });
  }
  function currentTab() {
    var b = tabs.querySelector('[aria-selected="true"]');
    return b && !b.hidden ? b.getAttribute('data-tab') : null;
  }

  (function chrome() {
    var navIco = document.getElementById('navIco');
    if (navIco) navIco.appendChild(icon('menu'));
    // ícone de cada item do menu lateral
    Array.prototype.forEach.call(tabs.children, function (b) {
      var name = b.getAttribute('data-icon');
      if (name) b.insertBefore(icon(name), b.firstChild);
    });

    // gaveta do celular
    var btn = document.getElementById('btnNav');
    var scrim = document.getElementById('scrim');
    function setNav(open) {
      document.body.classList.toggle('nav-open', open);
      if (btn) btn.setAttribute('aria-expanded', String(open));
      if (btn) btn.setAttribute('aria-label', open ? 'Fechar menu' : 'Abrir menu');
    }
    closeNav = function () { setNav(false); };
    if (btn) btn.addEventListener('click', function () { setNav(!document.body.classList.contains('nav-open')); });
    if (scrim) scrim.addEventListener('click', function () { setNav(false); });
    tabs.addEventListener('click', function () { setNav(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setNav(false); });
  })();

  if (!TOKEN) { showExpired(); return; }
  loadMe().then(function () {
    go('tryon');
  }).catch(function (e) { if (state.me) fail(e); });
})();
